import type { NextRequest } from "next/server";

/**
 * Meta WhatsApp Business Cloud API webhook (Module A — assumption).
 *
 * M1 stub (T2): GET performs the standard Meta verification handshake and
 * POST acknowledges the payload with 200. Nothing is verified against a
 * signature and nothing is stored yet — X-Hub-Signature-256 checking, event
 * idempotency (wa_webhook_events.event_key) and the bot reply land in T8.
 */

/** Dev fallback so the handshake is testable before env vars exist. */
const EXPECTED_VERIFY_TOKEN =
  process.env.WHATSAPP_VERIFY_TOKEN ?? "m1-dev-verify-token";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === EXPECTED_VERIFY_TOKEN && challenge) {
    // Meta expects the challenge echoed back as plain text.
    return new Response(challenge, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
  // Acknowledge immediately: Meta retries until it sees a 200. Processing
  // (signature check, inbox row, bot reply) is deferred to T8.
  await request.text().catch(() => undefined);
  return Response.json({ received: true });
}
