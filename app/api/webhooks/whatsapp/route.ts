import type { NextRequest } from "next/server";
import {
  processInboundPayload,
  verifyHubSignature,
  type WebhookProcessResult,
} from "@/lib/data";
import { getDataDriver } from "@/lib/data/driver";
import {
  processInboundMeta,
  processStatusUpdatesMeta,
} from "@/lib/supabase/meta-webhook";

/**
 * Meta WhatsApp Business Cloud API webhook (Module A — assumption).
 *
 * T8: GET performs the verification handshake, POST authenticates the
 * delivery with X-Hub-Signature-256 and stores each event exactly once.
 * Unit 2 adds outbound delivery: the Graph API call itself is made inside
 * `processInboundMeta` (lib/supabase/meta-webhook.ts → lib/supabase/
 * wa-graph.ts), never here — this route only parses, dispatches and
 * acknowledges. The send is skipped entirely when WHATSAPP_ACCESS_TOKEN /
 * WHATSAPP_PHONE_NUMBER_ID are absent, so the app keeps working inbox-only.
 *
 * Driver split (both paths idempotent on the event key):
 *  - fake    → in-memory store via processInboundPayload (no Graph sends,
 *    no status machinery: the fake layer has no wa_messages rows);
 *  - supabase→ service-role writes into wa_webhook_events / wa_* rows via
 *    processInboundMeta and, for Meta's `statuses` deliveries,
 *    processStatusUpdatesMeta (lib/supabase/meta-webhook.ts). The
 *    service-role key is read here, server-side only — never exposed to a
 *    client bundle.
 *
 * No hardcoded fallbacks: both secrets come from the environment and the
 * route refuses to answer without them (see `.env.example`).
 */

export async function GET(request: NextRequest) {
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!expected) {
    return new Response("Webhook verification is not configured", { status: 503 });
  }

  const { searchParams } = request.nextUrl;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === expected && challenge) {
    // Meta expects the challenge echoed back as plain text.
    return new Response(challenge, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    return Response.json(
      { error: "webhook_not_configured" },
      { status: 503 },
    );
  }

  // Read the raw body once: the signature covers these exact bytes.
  const body = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyHubSignature(body, signature, secret)) {
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return Response.json({ error: "invalid_payload" }, { status: 400 });
  }

  // Store + bot reply + delivery outcome. Duplicates (Meta retries) are
  // dropped inside both halves: the `statuses` delivery (sent/delivered/
  // read/failed) updates the outbound row it names, then any inbound
  // message is stored and answered. Counts are folded into the same
  // `accepted` / `duplicates` numbers Meta already sees.
  let result: WebhookProcessResult;
  if (getDataDriver() === "supabase") {
    const statuses = await processStatusUpdatesMeta(payload);
    const inbound = await processInboundMeta(payload);
    result = {
      accepted: inbound.accepted + statuses.applied,
      duplicates: inbound.duplicates + statuses.duplicates,
      replies: inbound.replies,
    };
  } else {
    result = await processInboundPayload(payload);
  }

  // Meta retries until it sees a 200 — always acknowledge a valid delivery.
  return Response.json({
    received: true,
    accepted: result.accepted,
    duplicates: result.duplicates,
  });
}
