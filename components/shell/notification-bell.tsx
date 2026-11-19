"use client";

import { useCallback, useEffect, useId, useReducer, useRef, useState, type FocusEvent } from "react";
import { Bell } from "lucide-react";
import { PreferenciasModal } from "@/app/(app)/notificaciones/preferencias-modal";
import { useToast } from "@/components/ui/toast";
import {
  BellPanel,
  bellItemReadOnOpen,
  bellPanelReducer,
  formatBellBadge,
  initialBellPanelState,
  loadBellPanelPage,
  type BellTab,
} from "@/components/shell/notification-bell-panel";
import { useUnreadCount } from "@/components/shell/use-unread-count";
import { listNotifications, markNotificationRead } from "@/lib/data";
import type { AppNotification } from "@/lib/types";

/**
 * Notification bell with unread badge (components.md block 2): the trigger
 * opens the anchored Todas/No leídas panel instead of navigating — the full
 * page is one explicit link inside it (recon S21: bell → panel, panel →
 * "Ver todas" → page).
 *
 * 44x44 target, count exposed in the accessible name ("N sin leer"), badge
 * capped at "9+". The count comes from the data layer (see `useUnreadCount`),
 * so it matches what /notificaciones shows. The panel reads through
 * `loadBellPanelPage` — the same driver, so the S21 preference gate
 * (ed451a1) keeps owning every insert and reads can never bypass it.
 *
 * Interaction follows the row-menu popover discipline: focus lands on the
 * selected tab, Esc closes and restores focus to the bell, an outside press
 * or Tab-out closes. Positioning is `absolute` (not the row-menu's fixed):
 * neither the sidebar nor the mobile header clips its children, so the
 * panel anchors to the trigger for free and never needs repositioning on
 * scroll/resize.
 */

type PanelLoad = {
  status: "loading" | "ready" | "error";
  items: AppNotification[];
};

export function NotificationBell() {
  const unread = useUnreadCount();
  const { toast } = useToast();
  const [panel, dispatch] = useReducer(bellPanelReducer, initialBellPanelState);
  const [load, setLoad] = useState<PanelLoad>({ status: "loading", items: [] });
  const [prefsOpen, setPrefsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  // Newest-request token: only the latest panel read may write state (the
  // page's rule — a slow tab switch can never overwrite the active one).
  const requestRef = useRef(0);

  const label =
    unread > 0 ? `Notificaciones, ${unread} sin leer` : "Notificaciones";
  const badge = formatBellBadge(unread);

  const fetchPanel = useCallback((tab: BellTab) => {
    const requestId = ++requestRef.current;
    loadBellPanelPage(tab)
      .then((page) => {
        if (requestId !== requestRef.current) return;
        setLoad({ status: "ready", items: page.items });
      })
      .catch(() => {
        if (requestId !== requestRef.current) return;
        setLoad((prev) => ({ status: "error", items: prev.items }));
      });
  }, []);

  // Read on open and on every tab switch. State resolves in the promise
  // callbacks (react-hooks/set-state-in-effect forbids sync setState here).
  useEffect(() => {
    if (!panel.open) return;
    fetchPanel(panel.tab);
  }, [panel.open, panel.tab, fetchPanel]);

  // Focus lands on the selected tab; an outside press closes without
  // stealing focus, Esc closes AND restores the bell (components.md block 2).
  useEffect(() => {
    if (!panel.open) return;

    panelRef.current
      ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.focus({ preventScroll: true });

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      dispatch({ type: "close" });
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      dispatch({ type: "close" });
      triggerRef.current?.focus({ preventScroll: true });
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [panel.open]);

  /** Tabbing out of the panel closes it (focus never dangles off-panel). */
  function handlePanelBlur(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget as Node | null;
    if (!next) return;
    if (panelRef.current?.contains(next)) return;
    if (triggerRef.current?.contains(next)) return;
    dispatch({ type: "close" });
  }

  function markAllRead() {
    // The FULL list, not the loaded page: with a panel capped at one page a
    // "todas" mark must still reach the rows the driver did not return.
    void listNotifications()
      .then((all) => all.filter((entry) => !entry.leida))
      .then((targets) =>
        Promise.all(targets.map((entry) => markNotificationRead(entry.id))),
      )
      .then(() => {
        // Re-read the active tab so "No leídas" empties instead of keeping
        // rows the filter no longer matches (the badge follows via emitChange).
        fetchPanel(panel.tab);
        toast("Listo: marcaste todas como leídas.");
      })
      .catch(() => {
        toast("No pudimos marcar las notificaciones como leídas.", {
          variant: "error",
        });
      });
  }

  function openPreferences() {
    // Never two dialogs at once: the panel yields to the modal.
    dispatch({ type: "close" });
    setPrefsOpen(true);
  }

  function selectItem(item: AppNotification) {
    bellItemReadOnOpen(item);
    dispatch({ type: "close" });
  }

  return (
    <div className="relative flex">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title="Notificaciones"
        aria-expanded={panel.open}
        aria-controls={panel.open ? panelId : undefined}
        onClick={() => dispatch({ type: "toggle" })}
        className="relative flex size-11 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-accent-tint hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Bell aria-hidden="true" className="size-5" />
        {badge !== null && (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 flex min-w-5 items-center justify-center rounded-pill bg-info px-1 text-xs font-semibold leading-5 text-on-accent"
          >
            {badge}
          </span>
        )}
      </button>

      {panel.open && (
        <div
          ref={panelRef}
          id={panelId}
          onBlur={handlePanelBlur}
          // Mobile bell sits at the right edge (anchor right); the desktop
          // sidebar bell sits at the left of the content (anchor left).
          className="absolute right-0 top-full z-50 mt-1 w-[var(--ds-layout-assistant-panel)] max-w-[calc(100vw-2rem)] md:left-0 md:right-auto"
        >
          <BellPanel
            panelId={panelId}
            tab={panel.tab}
            status={load.status}
            items={load.items}
            unread={unread}
            onTabChange={(tab) => dispatch({ type: "tab", tab })}
            onMarkAll={markAllRead}
            onPreferences={openPreferences}
            onRetry={() => fetchPanel(panel.tab)}
            onSelectItem={selectItem}
            onClose={() => dispatch({ type: "close" })}
          />
        </div>
      )}

      <PreferenciasModal
        open={prefsOpen}
        onClose={() => setPrefsOpen(false)}
      />
    </div>
  );
}
