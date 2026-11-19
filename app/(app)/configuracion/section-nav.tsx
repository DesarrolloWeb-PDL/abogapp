"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Section tabs shared by every screen under /configuracion (S30: Bot,
 * Etapas, Días inhábiles). The sidebar keeps ONE "Configuración" entry that
 * lands on /configuracion/bot; this nav is how the study reaches the other
 * two sections. The current section is marked with aria-current="page" —
 * state is never colour-only (the active tab also keeps its label weight).
 */

const SECTIONS = [
  { href: "/configuracion/bot", label: "Bot" },
  { href: "/configuracion/etapas", label: "Etapas" },
  { href: "/configuracion/dias-inhabiles", label: "Días inhábiles" },
] as const;

const TAB_BASE =
  "inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function ConfiguracionNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Secciones de configuración">
      <ul className="flex flex-wrap gap-2 border-b border-border pb-2">
        {SECTIONS.map((section) => {
          const active = pathname === section.href;
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={[
                  TAB_BASE,
                  active
                    ? "bg-accent-tint text-accent"
                    : "text-text-muted hover:bg-accent-tint hover:text-text",
                ].join(" ")}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
