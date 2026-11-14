"use client";

import { useState } from "react";

/**
 * WhatsApp inbox filter tabs (A01) — Module A is our own design (no
 * reference screen). Tabs are toggle buttons with aria-pressed; conversation
 * rows land in T8 with the webhook data.
 */

const TABS = ["Todas", "Bot activo", "Esperando", "Escaladas", "Cerradas"] as const;

export function InboxTabs() {
  const [active, setActive] = useState<(typeof TABS)[number]>("Todas");

  return (
    <div
      role="group"
      aria-label="Filtrar conversaciones"
      className="flex gap-2 overflow-x-auto pb-1"
    >
      {TABS.map((tab) => {
        const selected = active === tab;
        return (
          <button
            key={tab}
            type="button"
            aria-pressed={selected}
            onClick={() => setActive(tab)}
            className={[
              "min-h-11 shrink-0 rounded-md border px-4 text-base font-medium",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              selected
                ? "border-accent bg-accent-tint text-accent"
                : "border-input bg-surface text-text-muted hover:bg-accent-tint hover:text-text",
            ].join(" ")}
          >
            {tab}
          </button>
        );
      })}
    </div>
  );
}
