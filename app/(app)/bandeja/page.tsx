import type { Metadata } from "next";
import { InboxTabs } from "./inbox-tabs";

export const metadata: Metadata = { title: "Bandeja WhatsApp" };

/**
 * WhatsApp inbox (A01) — Module A, designed from scratch (no reference
 * screen). M1 shows the shell + empty state; the webhook → inbox → bot reply
 * loop arrives in T8.
 */
export default function BandejaPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-text">Bandeja WhatsApp</h1>
        <p className="text-base text-muted">
          Las consultas de tus clientes por WhatsApp aparecen acá, con la
          respuesta del bot y el paso a una persona del estudio.
        </p>
      </div>

      <InboxTabs />

      <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface px-6 py-12 text-center">
        <p className="text-base font-semibold text-text">
          Todavía no hay conversaciones de WhatsApp
        </p>
        <p className="max-w-md text-base text-muted">
          Cuando un cliente escriba al número del estudio, la conversación va a
          aparecer en esta bandeja.
        </p>
      </div>
    </div>
  );
}
