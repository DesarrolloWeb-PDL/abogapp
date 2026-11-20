"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import {
  DataLayerError,
  errorCopy,
  listCases,
  listEventCategories,
  type CalendarEvent,
  type EventCategory,
} from "@/lib/data";
import { createEvent, updateEvent } from "@/lib/data/events";
import type { StudyCase } from "@/lib/types";
import {
  createInputFromForm,
  defaultEventFormValues,
  eventFormValues,
  patchFromForm,
  validateEventForm,
  type EventFormErrors,
  type EventFormValues,
} from "./agenda-event-editor";

/**
 * Create/edit event form (S17, T5a): one Modal over the shared form
 * primitives, in create ("Nuevo evento" `C` / the top-bar button / a Día
 * slot prefill) and edit (the popover's Editar) modes.
 *
 * Fields are exactly what the `events` table stores: title, start/end
 * (datetime-local, ART wall clock — the editor module converts), location,
 * notes, expediente and category. The category select HIDES itself while
 * the study has no categories (T6 seeds them) and the expediente select
 * loads the study cases when the form opens — a load failure degrades to
 * the preselected option instead of blocking the save.
 *
 * Validation runs client-side first (the Spanish field errors the recon
 * shows inline) and the driver backstops both branches with typed codes;
 * focus management is the Modal's (trap + return to trigger).
 */

export interface AgendaEventFormProps {
  /** Existing event → edit; absent → create. */
  event?: CalendarEvent;
  /** Prefill for create (day slot, or the panel's anchors). */
  initialValues?: EventFormValues;
  onClose: () => void;
  /** Notified after a successful write so the panel can refetch + toast. */
  onSaved: (mode: "create" | "edit") => void;
}

/** Spanish copy for a typed data-layer failure, with a screen fallback. */
function messageFor(error: unknown, fallback: string): string {
  return error instanceof DataLayerError ? errorCopy(error.code) : fallback;
}

export function AgendaEventForm({
  event,
  initialValues,
  onClose,
  onSaved,
}: AgendaEventFormProps) {
  const mode = event ? "edit" : "create";
  const [values, setValues] = useState<EventFormValues>(
    () => (event ? eventFormValues(event) : initialValues ?? defaultEventFormValues()),
  );
  const [errors, setErrors] = useState<EventFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [cases, setCases] = useState<StudyCase[]>([]);
  const [casesLoaded, setCasesLoaded] = useState(false);

  // Focus management belongs to the Modal (trap + return-to-trigger); this
  // form only aims the initial caret at the title field once mounted.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      document.getElementById("agenda-event-title")?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Categories hide the select until T6 seeds them; cases power the
  // expediente select. Both reads are best-effort: a failure keeps the
  // form usable (categories → hidden, cases → only the preselected row).
  useEffect(() => {
    let cancelled = false;
    Promise.all([listEventCategories(), listCases()])
      .then(([categoryRows, caseRows]) => {
        if (cancelled) return;
        setCategories(categoryRows);
        setCases(caseRows);
        setCasesLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setCasesLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function update(patch: Partial<EventFormValues>) {
    setValues((prev) => ({ ...prev, ...patch }));
  }

  async function onSubmit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();

    const fieldErrors = validateEventForm(values);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      setFormError(null);
      return;
    }

    setErrors({});
    setFormError(null);
    setSaving(true);
    try {
      if (event) {
        const patch = patchFromForm(values);
        if (!patch) throw new DataLayerError("save_failed");
        await updateEvent(event.id, patch);
      } else {
        const input = createInputFromForm(values);
        if (!input) throw new DataLayerError("save_failed");
        await createEvent(input);
      }
      onSaved(mode);
    } catch (error) {
      setFormError(
        messageFor(
          error,
          mode === "create"
            ? "No pudimos crear el evento. Probá otra vez."
            : "No pudimos guardar los cambios. Probá otra vez.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === "create" ? "Nuevo evento" : "Editar evento"}
      busy={saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="agenda-event-form" loading={saving}>
            {saving
              ? mode === "create"
                ? "Creando…"
                : "Guardando…"
              : mode === "create"
                ? "Crear evento"
                : "Guardar cambios"}
          </Button>
        </>
      }
    >
      <form
        id="agenda-event-form"
        noValidate
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        <FormField
          id="agenda-event-title"
          label="Título"
          value={values.title}
          onChange={(changeEvent) => update({ title: changeEvent.target.value })}
          placeholder="Por ejemplo: Audiencia de conciliación"
          required
          error={errors.title}
        />

        <div className="flex flex-col gap-4 sm:flex-row">
          <FormField
            label="Inicio"
            type="datetime-local"
            value={values.start}
            onChange={(changeEvent) => update({ start: changeEvent.target.value })}
            required
            error={errors.start}
          />
          <FormField
            label="Fin"
            type="datetime-local"
            value={values.end}
            onChange={(changeEvent) => update({ end: changeEvent.target.value })}
            required
            error={errors.end}
          />
        </div>

        <FormField
          label="Lugar"
          value={values.location}
          onChange={(changeEvent) => update({ location: changeEvent.target.value })}
          placeholder="Secretaría, juzgado o dirección"
        />

        <div className="flex flex-col gap-2">
          <label
            htmlFor="agenda-event-notes"
            className="text-sm font-semibold text-text"
          >
            Notas
          </label>
          <textarea
            id="agenda-event-notes"
            rows={3}
            value={values.notes}
            onChange={(changeEvent) => update({ notes: changeEvent.target.value })}
            className="w-full rounded-md border border-border-input bg-surface px-3 py-2 text-base text-text placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            placeholder="Acá podés dejar el detalle del evento"
          />
        </div>

        {/* Dormant until T6 seeds categories ([] = hidden, never invented). */}
        {categories.length > 0 && (
          <FormField
            as="select"
            label="Categoría"
            value={values.categoryId}
            onChange={(changeEvent) => update({ categoryId: changeEvent.target.value })}
          >
            <option value="">Sin categoría</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </FormField>
        )}

        <FormField
          as="select"
          label="Expediente"
          value={values.caseId}
          onChange={(changeEvent) => update({ caseId: changeEvent.target.value })}
          disabled={!casesLoaded}
          hint={
            casesLoaded ? undefined : "Cargando expedientes del estudio…"
          }
        >
          <option value="">Sin expediente</option>
          {cases.map((row) => (
            <option key={row.id} value={row.id}>
              {row.caratula}
            </option>
          ))}
          {/* A preselected case outside the active list (archived or still
              loading) keeps its own row so the value never silently drops. */}
          {values.caseId && !cases.some((row) => row.id === values.caseId) && (
            <option value={values.caseId}>
              {event?.caseCaratula || "Expediente vinculado"}
            </option>
          )}
        </FormField>

        {formError && (
          <p role="alert" className="text-sm font-medium text-danger">
            {formError}
          </p>
        )}
        {/* The submit lives in the Modal footer; the button above targets
            this form by id, so Enter in any field submits natively. */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
