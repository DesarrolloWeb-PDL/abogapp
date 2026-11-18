"use client";

import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { MoreHorizontal } from "lucide-react";

/**
 * Row ⋯ menu (S07 data-table block): a trigger button plus a fixed-position
 * `role="menu"` popover — fixed escapes the table's horizontal scroll
 * container, so the menu is never clipped by it.
 *
 * Interaction details that keep this robust under real input:
 *  - the trigger toggles on POINTERDOWN (not click): a click that lands
 *    after a focus-scroll nudge can miss its target, but the first press
 *    event always hits, so the menu can never be "half-open";
 *  - outside presses close through a document CAPTURE listener, so a
 *    React handler calling stopPropagation (the trigger, the row) can
 *    never keep two menus open at once;
 *  - scroll/resize REPOSITION the panel instead of closing it (and the
 *    focus moves use preventScroll), so a browser or test-runner scroll
 *    never yanks the menu away mid-interaction;
 *  - focus lands on the first action; ArrowUp/Down cycle; Esc closes and
 *    returns focus to the trigger (and stops propagating so an open menu
 *    never also clears the row selection); Tab out closes.
 */

export interface RowMenuItem {
  key: string;
  label: string;
  /** Destructive action: danger colour, behind a separator. */
  danger?: boolean;
}

interface RowMenuProps {
  /** Accessible name for both the trigger and the panel: "Acciones de …". */
  label: string;
  items: RowMenuItem[];
  onSelect: (key: string) => void;
}

/** Menu row height (min-h-11 touch floor) for the open-position math. */
const ITEM_HEIGHT = 44;
/** Panel padding + separator allowance on top of the item rows. */
const PANEL_CHROME = 24;
/** Trigger↔panel gap — the popover `gap-1` step. */
const GAP = 4;

type PanelPosition = { top?: number; bottom?: number; right: number };

export function RowMenu({ label, items, onSelect }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PanelPosition>({ right: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
  }

  function openMenu() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    // The panel is not mounted yet: estimate from the item count; once
    // open, the effect below re-measures the real panel height.
    const rect = trigger.getBoundingClientRect();
    const height = items.length * ITEM_HEIGHT + PANEL_CHROME;
    const flip = rect.bottom + height > window.innerHeight;
    setPosition({
      top: flip ? undefined : rect.bottom + GAP,
      bottom: flip ? window.innerHeight - rect.top + GAP : undefined,
      right: window.innerWidth - rect.right,
    });
    setOpen(true);
  }

  function handleTriggerPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    // Runs before any native listener above the React root: other menus
    // close through their capture listeners before this one opens.
    event.stopPropagation();
    if (open) close(true);
    else openMenu();
  }

  function handleTriggerClick(event: MouseEvent<HTMLButtonElement>) {
    // The row itself opens the detail — never from a menu press.
    event.stopPropagation();
  }

  useEffect(() => {
    if (!open) return;

    // Keyboard users start ON the first action; preventScroll keeps a
    // focus nudge from firing the scroll handler below.
    panelRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus({ preventScroll: true });

    function reposition() {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const rect = trigger.getBoundingClientRect();
      const flip = rect.bottom + panel.offsetHeight > window.innerHeight;
      const next: PanelPosition = {
        top: flip ? undefined : rect.bottom + GAP,
        bottom: flip ? window.innerHeight - rect.top + GAP : undefined,
        right: window.innerWidth - rect.right,
      };
      setPosition((prev) =>
        prev.top === next.top &&
        prev.bottom === next.bottom &&
        prev.right === next.right
          ? prev
          : next,
      );
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const menuItems = Array.from(
        panelRef.current?.querySelectorAll<HTMLButtonElement>(
          '[role="menuitem"]',
        ) ?? [],
      );
      if (menuItems.length === 0) return;
      event.preventDefault();
      const current = menuItems.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      const next =
        event.key === "ArrowDown"
          ? (current + 1) % menuItems.length
          : (current - 1 + menuItems.length) % menuItems.length;
      menuItems[next]?.focus({ preventScroll: true });
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    // Capture phase: scrolls bubble from the page AND from the table's own
    // scroll container. Reposition (never close): a scroll means the
    // trigger moved, not that the user abandoned the menu.
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  /** Tabbing out of the panel closes it (focus never dangles off-menu). */
  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget as Node | null;
    if (!next) return;
    if (panelRef.current?.contains(next)) return;
    if (triggerRef.current?.contains(next)) return;
    setOpen(false);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onPointerDown={handleTriggerPointerDown}
        onClick={handleTriggerClick}
        className="flex size-11 items-center justify-center rounded-md text-text-muted hover:bg-accent-tint hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <MoreHorizontal aria-hidden="true" className="size-5" />
      </button>

      {open && (
        <div
          ref={panelRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onBlur={handleBlur}
          style={{
            top: position.top,
            bottom: position.bottom,
            right: position.right,
          }}
          className="fixed z-40 min-w-44 overflow-hidden rounded-md border border-border bg-surface py-1 shadow-pop"
        >
          {items.map((item, index) => (
            <Fragment key={item.key}>
              {item.danger && index > 0 && (
                <div
                  role="presentation"
                  className="mx-2 my-1 border-t border-border"
                />
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  close(true);
                  onSelect(item.key);
                }}
                className={[
                  "flex min-h-11 w-full items-center px-4 text-left text-base",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                  item.danger
                    ? "font-semibold text-danger hover:bg-danger-tint"
                    : "text-text hover:bg-accent-tint",
                ].join(" ")}
              >
                {item.label}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </>
  );
}
