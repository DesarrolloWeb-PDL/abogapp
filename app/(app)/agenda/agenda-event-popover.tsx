"use client";

import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  DataLayerError,
  errorCopy,
  type CalendarEvent,
  type EventCategory,
} from "@/lib/data";
import { updateEvent, createEvent, removeEvent } from "@/lib/data/events";
import { toArtIsoDate } from "@/lib/data/calendar";
import { formatDate } from "@/lib/format";
import { SOURCE_LABELS, formatTimeRange, sourceTone } from "./agenda-list";
import {
  createInputFromForm,
  eventFormValues,
  eventSourceAction,
  popoverMenuItems,
} from "./agenda-event-editor";
import { RowMenu } from "../expedientes/row-menu";

/**
 * Event detail popover (S17, T5a): source/category badges, ART time,
 * location + "Abrir en el mapa", the expediente link, notes, the action row
 * and the recon's ⋯ menu — anchored to its trigger and positioned like
 * RowMenu (fixed, repositions on scroll/resize instead of closing, Esc or
 * an outside press closes and focus returns to the trigger).
 *
 * Evidence-driven shape:
 *  - read-only sources (audiencia/vencimiento/dia_inhabil) swap the edit row
 *    for their single "Ver …" action (eventSourceAction);
 *  - manual rows carry the full edit family — Editar, Cambiar color (only
 *    while the study HAS categories; T6 seeds them), Duplicar (a copy of
 *    every field the user then edits) and Eliminar (behind the repo's
 *    destructive-confirm dialog); read-only sources never offer Duplicar or
 *    Eliminar, with the driver's manual-only guard as the backstop;
 *  - "Cambiar color" exists only while the study HAS categories (T6 seeds
 *    them) — an empty list hides the button, never inventing a palette; the
 *    picker maps a category onto the event because events carry no color
 *    column of their own (color lives in event_categories.color);
 *  - the ⋯ menu ships Copiar enlace + Ver el expediente; Abrir en Google
 *    Calendar is ABSENT (no credentials/sync in this build) and Preguntar
 *    al Asistente IA is ABSENT (no assistant surface or deep-link pattern
 *    exists in the clone to reuse) — both absences are unit-asserted;
 *  - "Copiar enlace" copies THIS calendar view's URL: the recon documents
 *    no per-event permalink, so none is invented here.
 *
 * Nested surfaces own their own keys: the ⋯ menu, the color dialog and the
 * delete confirm each see Escape first (target-based guards below), so one
 * Esc peels one layer.
 */

interface AgendaEventPopoverProps {
  event: CalendarEvent;
  /** The trigger element (positioning anchor + focus return). */
  anchor: HTMLElement;
  /** Study categories; empty until T6 → the color action hides. */
  categories: readonly EventCategory[];
  /** Stable identity (useCallback in the panel) so listeners subscribe once. */
  onClose: () => void;
  /** Opens the edit form in the panel (the popover closes itself after). */
  onEdit: (event: CalendarEvent) => void;
  /** After a successful mutation the panel refetches. */
  onChanged: () => void;
}

const POPOVER_WIDTH = 320;
const EDGE_MARGIN = 8;
const GAP = 4;
/** Height assumed before the panel mounts (RowMenu estimates the same way). */
const ESTIMATED_HEIGHT = 240;

type PanelPosition = { top?: number; bottom?: number; left: number };

export function AgendaEventPopover({
  event,
  anchor,
  categories,
  onClose,
  onEdit,
  onChanged,
}: AgendaEventPopoverProps) {
  const router = useRouter();
  const { toast } = useToast();
  const panelRef = useRef<HTMLDivElement>(null);
  /** True while the nested color dialog is open: it owns outside clicks.
   *  Kept as BOTH state (re-renders the Modal) and ref (read inside the
   *  document listeners without resubscribing them). */
  const colorOpenRef = useRef(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [position, setPosition] = useState<PanelPosition>(() => {
    // Measured during the first render so the panel never paints unanchored;
    // the effect below re-measures with its real height.
    const rect = anchor.getBoundingClientRect();
    const flip = rect.bottom + GAP + ESTIMATED_HEIGHT > window.innerHeight;
    return {
      top: flip ? undefined : rect.bottom + GAP,
      bottom: flip ? window.innerHeight - rect.top + GAP : undefined,
      left: Math.min(
        Math.max(rect.left, EDGE_MARGIN),
        Math.max(EDGE_MARGIN, window.innerWidth - POPOVER_WIDTH - EDGE_MARGIN),
      ),
    };
  });
  const [colorSaving, setColorSaving] = useState(false);
  const [colorError, setColorError] = useState<string | null>(null);
  // --- Duplicar / Eliminar (T5a remainder) ------------------------------
  const [duplicating, setDuplicating] = useState(false);
  /** True while the delete confirm is open: it owns outside presses the
   *  same way the color dialog does (ref = read inside the document
   *  listener without resubscribing it). */
  const deleteOpenRef = useRef(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    // Keyboard users land ON the first action.
    panelRef.current
      ?.querySelector<HTMLElement>("button, a[href]")
      ?.focus({ preventScroll: true });

    function computePosition(): PanelPosition {
      const rect = anchor.getBoundingClientRect();
      const height = panelRef.current?.offsetHeight ?? ESTIMATED_HEIGHT;
      const flip = rect.bottom + GAP + height > window.innerHeight;
      return {
        top: flip ? undefined : rect.bottom + GAP,
        bottom: flip ? window.innerHeight - rect.top + GAP : undefined,
        left: Math.min(
          Math.max(rect.left, EDGE_MARGIN),
          Math.max(EDGE_MARGIN, window.innerWidth - POPOVER_WIDTH - EDGE_MARGIN),
        ),
      };
    }
    // Re-measure with the real height — async callback, never a synchronous
    // setState in the effect body (react-hooks/set-state-in-effect).
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setPosition(computePosition());
    });

    function reposition() {
      if (!anchor.isConnected) {
        onClose(); // the trigger unmounted (the list refetched)
        return;
      }
      setPosition(computePosition());
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (colorOpenRef.current) return; // the color dialog owns its clicks
      if (deleteOpenRef.current) return; // the confirm owns its clicks
      if (panelRef.current?.contains(target)) return; // inside (incl. ⋯ menu)
      if (anchor.contains(target)) return; // the trigger toggles in the panel
      onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const target = event.target as Node | null;
      // A surface outside this panel (the color dialog) owns its own Escape.
      if (!target || !panelRef.current?.contains(target)) return;
      // The ⋯ menu owns Escape while it is open — checked by PRESENCE, not
      // by focus target: the menu opens on pointerdown, and the browser's
      // mousedown default re-focuses the trigger after RowMenu's effect
      // focuses the first item, so focus may sit on the trigger instead.
      if (panelRef.current?.querySelector('[role="menu"]')) return;
      event.stopPropagation();
      onClose();
      anchor.focus({ preventScroll: true });
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      cancelled = true;
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [anchor, onClose]);

  /** Tabbing out closes the popover — except into the nested color dialog. */
  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget as Node | null;
    if (!next) return;
    if (panelRef.current?.contains(next)) return;
    if (anchor.contains(next)) return;
    if (next instanceof Element && next.closest('[role="dialog"]')) return;
    onClose();
  }

  function handleMenuSelect(key: string) {
    if (key === "copy") {
      navigator.clipboard
        .writeText(window.location.href)
        .then(() => toast("Copiamos el enlace."))
        .catch(() => toast("No pudimos copiar el enlace.", { variant: "error" }));
      return;
    }
    if (key === "case" && event.caseId) {
      router.push(`/expedientes/${event.caseId}`);
    }
  }

  function openColorPicker() {
    colorOpenRef.current = true;
    setColorError(null);
    setColorOpen(true);
  }

  function closeColorPicker() {
    colorOpenRef.current = false;
    setColorOpen(false);
    setColorSaving(false);
    setColorError(null);
  }

  async function pickCategory(categoryId: string | null) {
    setColorSaving(true);
    setColorError(null);
    try {
      await updateEvent(event.id, { categoryId });
      closeColorPicker();
      toast("Actualizamos el color del evento.");
      onChanged();
      onClose();
    } catch (error) {
      setColorError(
        error instanceof DataLayerError
          ? errorCopy(error.code)
          : "No pudimos actualizar el color. Probá otra vez.",
      );
    } finally {
      setColorSaving(false);
    }
  }

  /** Duplicar: a copy of every field the user then edits (title, range,
   *  location, notes, expediente, category). The driver always writes a
   *  fresh manual row; a refusal toasts and the popover stays put. */
  async function duplicateEvent() {
    const input = createInputFromForm(eventFormValues(event));
    if (!input) {
      // Defensive: the form model already rejected an unparseable range.
      toast("No pudimos duplicar el evento. Probá otra vez.", {
        variant: "error",
      });
      return;
    }
    setDuplicating(true);
    try {
      await createEvent(input);
      toast("Duplicamos el evento.");
      onChanged();
      onClose();
    } catch (error) {
      toast(
        error instanceof DataLayerError
          ? errorCopy(error.code)
          : "No pudimos duplicar el evento. Probá otra vez.",
        { variant: "error" },
      );
    } finally {
      setDuplicating(false);
    }
  }

  function openDeleteConfirm() {
    deleteOpenRef.current = true;
    setDeleteError(null);
    setDeleteOpen(true);
  }

  function closeDeleteConfirm() {
    deleteOpenRef.current = false;
    setDeleteOpen(false);
    setDeleting(false);
    setDeleteError(null);
  }

  /** Eliminar: the confirm dialog pattern from expedientes/días inhábiles.
   *  removeEvent's manual-only guard backs it; a refusal keeps the dialog
   *  open so the typed error reads next to the confirm button. */
  async function confirmDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await removeEvent(event.id);
      closeDeleteConfirm();
      toast("Eliminamos el evento.");
      onChanged();
      onClose();
    } catch (error) {
      setDeleteError(
        error instanceof DataLayerError
          ? errorCopy(error.code)
          : "No pudimos eliminar el evento. Probá otra vez.",
      );
    } finally {
      setDeleting(false);
    }
  }

  const sourceAction = eventSourceAction(event);
  const editable = event.source === "manual";
  const showColor = editable && categories.length > 0;
  const artDay = Number.isNaN(Date.parse(event.startAt))
    ? ""
    : toArtIsoDate(new Date(Date.parse(event.startAt)));
  const hasNotes = event.notes.trim().length > 0;
  const dialogLabel = event.title.trim()
    ? `Detalle del evento: ${event.title}`
    : "Detalle del evento";

  return (
    <>
      <div
        ref={panelRef}
        role="dialog"
        aria-label={dialogLabel}
        onBlur={handleBlur}
        style={{ top: position.top, bottom: position.bottom, left: position.left }}
        className="fixed z-40 flex w-80 flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-pop"
      >
        <div className="flex flex-wrap items-center gap-2">
          {event.source !== "manual" && (
            <Badge tone={sourceTone(event.source)}>
              {SOURCE_LABELS[event.source]}
            </Badge>
          )}
          {event.category && (
            <Badge tone="neutral">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full"
                style={{ backgroundColor: event.category.color }}
              />
              {event.category.name}
            </Badge>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-base font-semibold text-text">
            {event.title || "Sin título"}
          </p>
          <p className="text-sm text-text-muted">
            {artDay && <>{formatDate(artDay)} · </>}
            {formatTimeRange(event.startAt, event.endAt)}
          </p>
        </div>

        {event.location && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-text">
            <MapPin aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
            <span className="min-w-0 break-words">{event.location}</span>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Abrir en el mapa
            </a>
          </div>
        )}

        {event.caseId && (
          <Link
            href={`/expedientes/${event.caseId}`}
            onClick={onClose}
            className="font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {event.caseCaratula || "Ver el expediente"}
          </Link>
        )}

        {hasNotes && (
          <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-sm text-text-muted">
            {event.notes}
          </p>
        )}

        {/* Actions: manual rows carry the edit family — Editar, Cambiar
            color (while the study has categories), Duplicar and Eliminar
            (behind its confirm); read-only rows swap all of them for their
            single source action, so derived events never offer a copy or a
            delete the driver would refuse anyway. */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {editable ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  onEdit(event);
                  onClose();
                }}
              >
                Editar
              </Button>
              {showColor && (
                <Button size="sm" variant="secondary" onClick={openColorPicker}>
                  Cambiar color
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                onClick={duplicateEvent}
                loading={duplicating}
              >
                {duplicating ? "Duplicando…" : "Duplicar"}
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={openDeleteConfirm}
                disabled={duplicating}
              >
                Eliminar
              </Button>
            </>
          ) : (
            sourceAction && (
              <Link
                href={sourceAction.href}
                onClick={onClose}
                className="inline-flex min-h-8 items-center rounded-md border border-border-input bg-surface px-3 text-sm font-semibold text-text hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {sourceAction.label}
              </Link>
            )
          )}
          <span className="ml-auto">
            <RowMenu
              label={`Más acciones del evento ${event.title || ""}`.trim()}
              items={popoverMenuItems(event)}
              onSelect={handleMenuSelect}
            />
          </span>
        </div>
      </div>

      <Modal
        open={colorOpen}
        onClose={closeColorPicker}
        title="Cambiar color"
        description="Elegí la categoría que le da color al evento."
        busy={colorSaving}
        footer={
          <Button variant="ghost" onClick={closeColorPicker} disabled={colorSaving}>
            Cancelar
          </Button>
        }
      >
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={colorSaving}
            onClick={() => pickCategory(null)}
            className="flex min-h-11 items-center gap-3 rounded-md border border-border-input bg-surface px-3 text-left text-base text-text hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            <span
              aria-hidden="true"
              className="size-3 rounded-full border border-border-input"
            />
            Sin categoría
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              disabled={colorSaving}
              onClick={() => pickCategory(category.id)}
              className="flex min-h-11 items-center gap-3 rounded-md border border-border-input bg-surface px-3 text-left text-base text-text hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              <span
                aria-hidden="true"
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: category.color }}
              />
              {category.name}
            </button>
          ))}
          {colorError && (
            <p role="alert" className="text-sm font-medium text-danger">
              {colorError}
            </p>
          )}
        </div>
      </Modal>

      {/* Destructive confirm, same shape as expedientes and días inhábiles:
          title + why-it-hurts description, Cancelar, danger confirm with a
          busy label, and the refusal shown inline (the dialog stays open). */}
      <Modal
        open={deleteOpen}
        onClose={closeDeleteConfirm}
        title="Eliminar evento"
        description={`¿Seguro que querés eliminar «${event.title || "este evento"}»? Esta acción no se puede deshacer.`}
        busy={deleting}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={closeDeleteConfirm}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button variant="danger" onClick={confirmDelete} loading={deleting}>
              {deleting ? "Eliminando…" : "Eliminar"}
            </Button>
          </>
        }
      >
        {deleteError && (
          <p role="alert" className="text-sm font-medium text-danger">
            {deleteError}
          </p>
        )}
      </Modal>
    </>
  );
}
