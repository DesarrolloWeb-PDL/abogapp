"use client";

import Link from "next/link";
import { useRef, type KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/skeleton";
import {
  listNotificationsPage,
  markNotificationRead,
  type NotificationEstado,
  type NotificationPage,
} from "@/lib/data";
import type { AppNotification } from "@/lib/types";

/**
 * Bell dropdown panel (recon S21 + components.md block 2): the anchored
 * `Todas / No leídas` panel the header bell opens, plus the pure pieces
 * behind it.
 *
 * Split from notification-bell.tsx so components/shell/notification-bell.test.tsx
 * can drive the state machine, the tab→driver wiring and the markup without
 * a DOM (the vitest setup is node-only — no jsdom/RTL in the dependency
 * tree; the DOM interaction lives in e2e/bell.spec.ts).
 *
 * Reads go through `listNotificationsPage` — the SAME driver the
 * /notificaciones page reads with (fake or Supabase), so the panel can never
 * disagree with the page and the S21 emission gate (ed451a1) stays where it
 * belongs: on the insert seams, untouched by a read.
 */

export type BellTab = "todas" | "no_leidas";

export interface BellPanelState {
  open: boolean;
  tab: BellTab;
}

export type BellPanelAction =
  | { type: "toggle" }
  | { type: "close" }
  | { type: "tab"; tab: BellTab };

export const initialBellPanelState: BellPanelState = {
  open: false,
  tab: "todas",
};

/** The panel's two tabs, in visual order (recon S21: Todas / No leídas). */
export const BELL_TABS: readonly { value: BellTab; label: string }[] = [
  { value: "todas", label: "Todas" },
  { value: "no_leidas", label: "No leídas" },
] as const;

/**
 * Open/close state for the dropdown. Closing always returns to `Todas`:
 * every open starts on the default view — the tabs are a filter over the
 * same list, not a preference the panel remembers.
 */
export function bellPanelReducer(
  state: BellPanelState,
  action: BellPanelAction,
): BellPanelState {
  switch (action.type) {
    case "toggle":
      return state.open ? initialBellPanelState : { open: true, tab: "todas" };
    case "close":
      return initialBellPanelState;
    case "tab":
      return { ...state, tab: action.tab };
  }
}

/**
 * Tab → the estado the S21 page's Estado select filters with. The two
 * vocabularies coincide on purpose: one shared contract, one predicate
 * (notificationMatchesEstado), zero drift between panel and page.
 */
export function bellTabEstado(tab: BellTab): NotificationEstado {
  switch (tab) {
    case "todas":
      return "todas";
    case "no_leidas":
      return "no_leidas";
  }
}

/** First panel page through the SAME driver /notificaciones reads with. */
export async function loadBellPanelPage(tab: BellTab): Promise<NotificationPage> {
  return listNotificationsPage({ estado: bellTabEstado(tab) });
}

/** Badge text (components.md block 2): hidden at 0, capped at "9+". */
export function formatBellBadge(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > 9 ? "9+" : String(unread);
}

/**
 * Read-on-click: the row's Link onClick seam — marks read through the data
 * layer (whose change emission the badge listens to) and lets the href do
 * the navigating. An already-read row never writes.
 */
export function bellItemReadOnOpen(item: AppNotification): void {
  if (item.leida) return;
  void markNotificationRead(item.id).catch(() => undefined);
}

/* ------------------------------------------------------------- markup ---- */

const CATEGORY_TONE: Record<
  AppNotification["categoria"],
  "neutral" | "info" | "warning" | "accent"
> = {
  Plazos: "warning",
  Expedientes: "info",
  Sistema: "neutral",
  Equipo: "accent",
};

function formatPanelDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function panelTabId(panelId: string, tab: BellTab): string {
  return `${panelId}-tab-${tab}`;
}

export interface BellPanelProps {
  /** useId() from the bell: prefixes every tab/panel id. */
  panelId: string;
  tab: BellTab;
  status: "loading" | "ready" | "error";
  /** Rows the current tab's read returned (driver-side filtered). */
  items: AppNotification[];
  /** Full-list unread count: drives the mark-all button (same as the page). */
  unread: number;
  onTabChange: (tab: BellTab) => void;
  onMarkAll: () => void;
  onPreferences: () => void;
  onRetry: () => void;
  /** Read-on-click + close; the container routes it through the data layer. */
  onSelectItem: (item: AppNotification) => void;
  /** Footer escape to /notificaciones (navigation follows). */
  onClose: () => void;
}

/**
 * Presentational panel: `role="dialog"` with an accessible name, the two
 * tabs (roving tabindex + arrow keys), the row list (arrow keys move rows,
 * Enter follows the deep link), mark-all + Preferencias and the escape to
 * the full page. All state and effects live in notification-bell.tsx.
 */
export function BellPanel({
  panelId,
  tab,
  status,
  items,
  unread,
  onTabChange,
  onMarkAll,
  onPreferences,
  onRetry,
  onSelectItem,
  onClose,
}: BellPanelProps) {
  const listRef = useRef<HTMLUListElement>(null);

  // Tabs: Left/Right/Home/End move the selection (automatic activation —
  // the fetch that follows is token-guarded in the bell).
  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    event.preventDefault();
    const index = BELL_TABS.findIndex((entry) => entry.value === tab);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? BELL_TABS.length - 1
          : event.key === "ArrowRight"
            ? (index + 1) % BELL_TABS.length
            : (index - 1 + BELL_TABS.length) % BELL_TABS.length;
    const next = BELL_TABS[nextIndex];
    onTabChange(next.value);
    document
      .getElementById(panelTabId(panelId, next.value))
      ?.focus({ preventScroll: true });
  }

  // components.md block 2: inside the panel arrow keys move rows (the rows
  // with a deep link are the focusable ones; rows without navigation stay
  // plain content, like on the page).
  function handleListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? [],
    );
    const current = rows.indexOf(document.activeElement as HTMLAnchorElement);
    if (current === -1) return;
    event.preventDefault();
    const next =
      event.key === "ArrowDown"
        ? (current + 1) % rows.length
        : (current - 1 + rows.length) % rows.length;
    rows[next]?.focus({ preventScroll: true });
  }

  const emptyCopy =
    tab === "no_leidas"
      ? "Estás al día con las novedades de tu estudio."
      : "No hay notificaciones nuevas.";

  function rowBody(item: AppNotification) {
    return (
      <>
        <span className="flex items-center gap-2">
          {!item.leida && (
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-pill bg-info"
            />
          )}
          <span
            className={
              item.leida
                ? "text-base font-medium text-text-muted"
                : "text-base font-semibold text-text"
            }
          >
            {item.titulo}
          </span>
          {/* Read state is weight + dot + this text — never colour alone. */}
          <span className="sr-only">
            {item.leida ? "(leída)" : "(sin leer)"}
          </span>
        </span>
        <span className="text-base text-text-muted">{item.detalle}</span>
        <span className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
          <Badge tone={CATEGORY_TONE[item.categoria]}>{item.categoria}</Badge>
          {formatPanelDateTime(item.createdAt)}
        </span>
      </>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Notificaciones"
      className="flex max-h-[calc(100dvh-5rem)] w-full flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-pop"
    >
      <div
        role="tablist"
        aria-label="Filtro de notificaciones"
        onKeyDown={handleTabKeyDown}
        className="flex gap-2 border-b border-border p-2"
      >
        {BELL_TABS.map((entry) => {
          const selected = entry.value === tab;
          return (
            <button
              key={entry.value}
              type="button"
              role="tab"
              id={panelTabId(panelId, entry.value)}
              aria-selected={selected}
              aria-controls={`${panelId}-list`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onTabChange(entry.value)}
              className={[
                "flex min-h-11 flex-1 items-center justify-center rounded-md px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                selected
                  ? "bg-accent-tint font-semibold text-accent"
                  : "text-text-muted hover:bg-accent-tint hover:text-text",
              ].join(" ")}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      <div
        id={`${panelId}-list`}
        role="tabpanel"
        aria-labelledby={panelTabId(panelId, tab)}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {status === "loading" && (
          <div className="p-3" aria-busy="true">
            <p role="status" className="sr-only">
              Cargando notificaciones
            </p>
            <SkeletonRows rows={3} />
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
            <p className="text-base text-text-muted">
              No pudimos cargar las notificaciones.
            </p>
            <Button variant="secondary" onClick={onRetry}>
              Reintentar
            </Button>
          </div>
        )}

        {status === "ready" && items.length === 0 && (
          <div className="px-4 py-6 text-center text-base text-text-muted">
            {emptyCopy}
          </div>
        )}

        {status === "ready" && items.length > 0 && (
          <ul ref={listRef} onKeyDown={handleListKeyDown} className="flex flex-col">
            {items.map((item) => (
              <li
                key={item.id}
                className="border-b border-border last:border-b-0"
              >
                {item.enlace ? (
                  <Link
                    href={item.enlace}
                    onClick={() => onSelectItem(item)}
                    className="flex min-h-11 flex-col gap-1 px-4 py-3 hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
                  >
                    {rowBody(item)}
                  </Link>
                ) : (
                  <div className="flex min-h-11 flex-col gap-1 px-4 py-3">
                    {rowBody(item)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-2 border-t border-border p-3">
        <Button
          variant="secondary"
          onClick={onMarkAll}
          disabled={unread === 0}
          className="flex-1"
        >
          Marcar todas como leídas
        </Button>
        <Button variant="secondary" onClick={onPreferences}>
          Preferencias
        </Button>
      </div>

      <div className="border-t border-border p-2">
        <Link
          href="/notificaciones"
          onClick={onClose}
          className="flex min-h-11 items-center justify-center rounded-md px-3 text-sm font-semibold text-accent hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Ver la lista completa
        </Link>
      </div>
    </div>
  );
}
