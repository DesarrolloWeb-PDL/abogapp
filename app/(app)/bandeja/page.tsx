import type { Metadata } from "next";
import { InboxView } from "./inbox-view";

export const metadata: Metadata = { title: "Bandeja WhatsApp" };

/**
 * WhatsApp inbox (A01) — Module A, designed from scratch (no reference
 * screen). Conversations, filters, empty state and the retry path live in
 * `InboxView`, which reads `GET /api/wa/conversations` — the store the
 * webhook writes into (T8).
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

      <InboxView />
    </div>
  );
}
