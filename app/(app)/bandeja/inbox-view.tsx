"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/skeleton";
import type { WaConversation, WaConversationStatus } from "@/lib/types";

/**
 * WhatsApp inbox list (A01) — Module A, designed from scratch.
 *
 * Conversations come from `GET /api/wa/conversations`, the route that reads
 * the server-side store the webhook writes into; the client-side seed copy
 * is not the inbox of record. Every state is handled: loading (skeletons),
 * fetch error (retry), no conversations at all, and a filter that yields
 * nothing.
 */

type Filter = "todas" | WaConversationStatus;

const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: "todas", label: "Todas" },
  { value: "bot", label: "Bot" },
  { value: "humano", label: "Humano" },
  { value: "cerrada", label: "Cerradas" },
];

const STATUS_LABEL: Record<WaConversationStatus, string> = {
  bot: "Bot",
  humano: "Humano",
  cerrada: "Cerrada",
};

const STATUS_TONE: Record<WaConversationStatus, BadgeTone> = {
  bot: "accent",
  humano: "info",
  cerrada: "neutral",
};

const ART = "America/Argentina/Buenos_Aires";
const timeFormat = new Intl.DateTimeFormat("es-AR", {
  timeZone: ART,
  dateStyle: "short",
  timeStyle: "short",
});

type LoadState = "loading" | "ready" | "error";

export function InboxView() {
  const [state, setState] = useState<LoadState>("loading");
  const [conversations, setConversations] = useState<WaConversation[]>([]);
  const [filter, setFilter] = useState<Filter>("todas");

  // No sync setState here: the effect only kicks off the read and resolves
  // into state through the promise callbacks (react-hooks/set-state-in-effect).
  const load = useCallback(() => {
    fetch("/api/wa/conversations")
      .then((response) => {
        if (!response.ok) throw new Error(`status ${response.status}`);
        return response.json() as Promise<{ conversations: WaConversation[] }>;
      })
      .then((payload) => {
        setConversations(payload.conversations ?? []);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function retry() {
    setState("loading");
    load();
  }

  const visible = conversations.filter(
    (entry) => filter === "todas" || entry.status === filter,
  );

  return (
    <div className="flex flex-col gap-4">
      <div
        role="group"
        aria-label="Filtrar conversaciones"
        className="flex flex-wrap gap-2"
      >
        {FILTERS.map((entry) => {
          const count =
            entry.value === "todas"
              ? conversations.length
              : conversations.filter((item) => item.status === entry.value).length;
          const active = filter === entry.value;
          return (
            <button
              key={entry.value}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(entry.value)}
              className={[
                "min-h-11 rounded-md border px-3 text-base font-semibold",
                active
                  ? "border-accent bg-accent-tint text-accent"
                  : "border-border bg-surface text-text-muted",
              ].join(" ")}
            >
              {entry.label} ({count})
            </button>
          );
        })}
      </div>

      {state === "loading" && <SkeletonRows rows={3} />}

      {state === "error" && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-10 text-center">
          <p className="text-base font-semibold text-text">
            No pudimos cargar la bandeja
          </p>
          <Button variant="secondary" onClick={retry}>
            <RefreshCw aria-hidden="true" className="size-4" />
            Reintentar
          </Button>
        </div>
      )}

      {state === "ready" && conversations.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-12 text-center">
          <p className="text-base font-semibold text-text">
            Todavía no hay conversaciones de WhatsApp
          </p>
          <p className="max-w-md text-base text-muted">
            Cuando un cliente escriba al número del estudio, la conversación va
            a aparecer en esta bandeja.
          </p>
        </div>
      )}

      {state === "ready" && conversations.length > 0 && visible.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-10 text-center">
          <p className="text-base font-semibold text-text">
            No hay conversaciones con este filtro
          </p>
          <Button variant="ghost" onClick={() => setFilter("todas")}>
            Ver todas
          </Button>
        </div>
      )}

      {state === "ready" && visible.length > 0 && (
        <ul className="flex flex-col gap-2">
          {visible.map((entry) => (
            <li
              key={entry.id}
              className="flex items-start justify-between gap-4 rounded-lg border border-border bg-surface p-4"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold text-text">
                    {entry.contactName}
                  </span>
                  <Badge tone={STATUS_TONE[entry.status]}>
                    {STATUS_LABEL[entry.status]}
                  </Badge>
                  {entry.unread > 0 && (
                    <Badge tone="accent">
                      {entry.unread} sin leer
                    </Badge>
                  )}
                </div>
                <span className="text-sm text-text-muted">{entry.phone}</span>
                <p className="truncate text-base text-muted">
                  {entry.lastSnippet || "Sin mensajes"}
                </p>
              </div>
              <time
                className="shrink-0 text-sm text-text-muted"
                dateTime={entry.lastMessageAt}
              >
                {timeFormat.format(new Date(entry.lastMessageAt))}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
