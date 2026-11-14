import { listConversations } from "@/lib/data";

/**
 * WhatsApp inbox list (Module A) — `GET /api/wa/conversations`.
 *
 * The inbox reads through this route instead of the client-side store: the
 * webhook writes on the server, so this is the only place where a fresh
 * inbound conversation is visible to the browser. Membership checks ride
 * along with the real data layer; the fake one has no server session yet.
 */
export async function GET() {
  const conversations = await listConversations();
  return Response.json({ conversations });
}
