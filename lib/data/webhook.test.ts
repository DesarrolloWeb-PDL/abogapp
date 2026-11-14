import { beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  parseInboundMessages,
  processInboundPayload,
  verifyHubSignature,
} from "./webhook";
import { resetDataStore } from "./store";

const SECRET = "test-app-secret";

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

function metaPayload(text: string, id = "wamid.ABC123", from = "+5491155550001") {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                { id, from, type: "text", text: { body: text }, profile: { name: "Ana" } },
              ],
            },
          },
        ],
      },
    ],
  };
}

beforeEach(() => {
  resetDataStore();
});

describe("verifyHubSignature", () => {
  const body = JSON.stringify(metaPayload("hola"));

  it("accepts a signature produced with the app secret", () => {
    assert.equal(verifyHubSignature(body, sign(body), SECRET), true);
  });

  it("rejects a signature produced with another secret", () => {
    assert.equal(verifyHubSignature(body, sign(body, "wrong"), SECRET), false);
  });

  it("rejects a tampered body", () => {
    assert.equal(verifyHubSignature(`${body} `, sign(body), SECRET), false);
  });

  it("rejects a missing or malformed header", () => {
    assert.equal(verifyHubSignature(body, null, SECRET), false);
    assert.equal(verifyHubSignature(body, "deadbeef", SECRET), false);
    assert.equal(verifyHubSignature(body, "sha256=zz", SECRET), false);
  });
});

describe("parseInboundMessages", () => {
  it("reads the text message out of a Meta payload", () => {
    const parsed = parseInboundMessages(metaPayload("¿Cuánto cuesta la consulta?"));
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.text, "¿Cuánto cuesta la consulta?");
    assert.equal(parsed[0]?.phone, "+5491155550001");
    assert.equal(parsed[0]?.contactName, "Ana");
    assert.ok(parsed[0]?.eventKey);
  });

  it("skips non-text messages and malformed payloads", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { id: "wamid.IMAGE", from: "+54911", type: "image", image: { id: "x" } },
                ],
              },
            },
          ],
        },
      ],
    };
    assert.deepEqual(parseInboundMessages(payload), []);
    assert.deepEqual(parseInboundMessages(null), []);
    assert.deepEqual(parseInboundMessages({}), []);
    assert.deepEqual(parseInboundMessages("nope"), []);
  });
});

describe("processInboundPayload — webhook to inbox to bot", () => {
  it("stores the message, replies and marks the event processed", async () => {
    const result = await processInboundPayload(metaPayload("hola"));
    assert.equal(result.accepted, 1);
    assert.equal(result.duplicates, 0);
    assert.equal(result.replies.length, 1);
    assert.match(result.replies[0] ?? "", /asistente del estudio/);

    const { listConversations, listMessages } = await import("./whatsapp");
    const conversations = await listConversations();
    const conversation = conversations.find((entry) => entry.phone === "+5491155550001");
    assert.ok(conversation, "the inbox must show the new conversation");
    assert.equal(conversation.unread, 1);

    const messages = await listMessages(conversation.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[0]?.direction, "inbound");
    assert.equal(messages[1]?.direction, "outbound");
  });

  it("is idempotent: a Meta retry with the same event key is a no-op", async () => {
    const payload = metaPayload("hola");
    const first = await processInboundPayload(payload);
    const retry = await processInboundPayload(payload);

    assert.equal(first.accepted, 1);
    assert.equal(retry.accepted, 0);
    assert.equal(retry.duplicates, 1);
    assert.equal(retry.replies.length, 0);

    const { listMessages } = await import("./whatsapp");
    const { listConversations } = await import("./whatsapp");
    const conversation = (await listConversations()).find(
      (entry) => entry.phone === "+5491155550001",
    );
    assert.ok(conversation);
    assert.equal((await listMessages(conversation.id)).length, 2, "no duplicate rows");
  });

  it("honours STOP by closing the conversation without a reply", async () => {
    const result = await processInboundPayload(metaPayload("stop"));
    assert.equal(result.accepted, 1);
    assert.equal(result.replies.length, 0);

    const { listConversations } = await import("./whatsapp");
    const conversation = (await listConversations()).find(
      (entry) => entry.phone === "+5491155550001",
    );
    assert.equal(conversation?.status, "cerrada");
  });
});
