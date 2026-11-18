"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  BOT_MESSAGE_MAX,
  DataLayerError,
  ERROR_COPY,
  getBotSettings,
  requireStudy,
  updateBotSettings,
  validateBotSettingsInput,
  type BotSettings,
  type BotSettingsFieldErrors,
} from "@/lib/data";

/**
 * Bot settings form (WhatsApp Unit 1). Reads the study's `bot_settings`
 * through the data layer (driver switch), validates per field with Spanish
 * inline copy, saves through updateBotSettings and confirms with the shared
 * toast. Loading (skeleton), error + retry and the ready form are the three
 * states; "no permission" collapses into the error state in M1 — RLS only
 * returns rows to members, and every member may edit (no roles gate yet,
 * see whatsapp-bot.md §7).
 */

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; settings: BotSettings };

interface FormValues {
  enabled: boolean;
  greeting: string;
  offHours: string;
  handoff: string;
}

function toForm(settings: BotSettings): FormValues {
  return {
    enabled: settings.enabled,
    greeting: settings.greeting,
    offHours: settings.offHours,
    handoff: settings.handoff,
  };
}

/** Token-only textarea treatment, mirroring fieldClasses in ui/input. */
function textareaClasses(invalid: boolean): string {
  return [
    "min-h-32 w-full rounded-md border bg-surface px-3 py-2 text-base text-text",
    "placeholder:text-text-muted",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
    "disabled:cursor-not-allowed disabled:bg-bg disabled:text-text-muted",
    invalid ? "border-danger" : "border-border-input",
  ].join(" ");
}

interface MessageFieldProps {
  id: string;
  label: string;
  hint: string;
  value: string;
  error?: string;
  maxLength: number;
  onChange: (value: string) => void;
}

/** Label + textarea + hint/counter + inline error, a11y wired once. */
function MessageField({
  id,
  label,
  hint,
  value,
  error,
  maxLength,
  onChange,
}: MessageFieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hintId, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-text">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        rows={4}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        className={textareaClasses(Boolean(error))}
      />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p id={hintId} className="text-sm text-text-muted">
          {hint}
        </p>
        <span aria-hidden="true" className="text-xs text-text-muted">
          {value.length}/{maxLength}
        </span>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function BotSettingsView() {
  const { toast } = useToast();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [form, setForm] = useState<FormValues>({
    enabled: true,
    greeting: "",
    offHours: "",
    handoff: "",
  });
  const [fieldErrors, setFieldErrors] = useState<BotSettingsFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Bumped by "Reintentar" so the load effect runs again.
  const [reload, setReload] = useState(0);

  // The effect only starts the read; state resolves through the promise
  // callbacks (react-hooks/set-state-in-effect forbids sync setState here).
  useEffect(() => {
    let cancelled = false;
    requireStudy()
      .then((study) => getBotSettings(study.id))
      .then((settings) => {
        if (cancelled) return;
        setState({ status: "ready", settings });
        setForm(toForm(settings));
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  function retryLoad() {
    setState({ status: "loading" });
    setReload((count) => count + 1);
  }

  function resetForm() {
    if (state.status !== "ready") return;
    setForm(toForm(state.settings));
    setFieldErrors({});
    setFormError(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== "ready") return;

    // Precise per-field Spanish copy first; updateBotSettings re-validates
    // as the typed-error backstop for anything that bypasses this form.
    const errors = validateBotSettingsInput(form);
    if (errors.greeting || errors.offHours || errors.handoff) {
      setFieldErrors(errors);
      setFormError(null);
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setPending(true);

    try {
      const saved = await updateBotSettings({
        studyId: state.settings.studyId,
        ...form,
      });
      setState({ status: "ready", settings: saved });
      setForm(toForm(saved));
      toast("Guardamos la configuración del bot.");
    } catch (error) {
      setFormError(
        error instanceof DataLayerError
          ? ERROR_COPY[error.code]
          : "No pudimos guardar la configuración. Intentá de nuevo.",
      );
    } finally {
      setPending(false);
    }
  }

  if (state.status === "loading") {
    return (
      <div
        aria-busy="true"
        className="flex flex-col gap-6 rounded-lg border border-border bg-surface p-6"
      >
        <p role="status" className="sr-only">
          Cargando la configuración del bot
        </p>
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        role="alert"
        className="flex flex-col items-center gap-4 rounded-lg border border-border bg-surface px-6 py-12 text-center"
      >
        <p className="text-base text-text-muted">
          No pudimos cargar la configuración del bot.
        </p>
        <Button variant="secondary" onClick={retryLoad}>
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="flex max-w-2xl flex-col gap-6 rounded-lg border border-border bg-surface p-6"
    >
      <div className="flex flex-col gap-2">
        <label htmlFor="bot-enabled" className="text-sm font-semibold text-text">
          Bot activado
        </label>
        <div className="flex items-center gap-3">
          <input
            id="bot-enabled"
            type="checkbox"
            checked={form.enabled}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                enabled: event.target.checked,
              }))
            }
            className="size-5 rounded-sm border-border-input accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <span className="text-sm text-text-muted">
            {form.enabled
              ? "El bot responde a los saludos de tus clientes."
              : "El bot está en pausa: no responde a los mensajes."}
          </span>
        </div>
      </div>

      <MessageField
        id="bot-greeting"
        label="Saludo"
        hint="Respuesta del bot cuando alguien escribe un saludo, por ejemplo «hola»."
        value={form.greeting}
        error={fieldErrors.greeting}
        maxLength={BOT_MESSAGE_MAX}
        onChange={(value) =>
          setForm((current) => ({ ...current, greeting: value }))
        }
      />

      <MessageField
        id="bot-off-hours"
        label="Fuera de horario"
        hint="Texto para avisar el horario de atención: lunes a viernes de 9 a 18."
        value={form.offHours}
        error={fieldErrors.offHours}
        maxLength={BOT_MESSAGE_MAX}
        onChange={(value) =>
          setForm((current) => ({ ...current, offHours: value }))
        }
      />

      <MessageField
        id="bot-handoff"
        label="Traspaso a humano"
        hint="Texto para avisar que la consulta la retoma una persona del estudio."
        value={form.handoff}
        error={fieldErrors.handoff}
        maxLength={BOT_MESSAGE_MAX}
        onChange={(value) =>
          setForm((current) => ({ ...current, handoff: value }))
        }
      />

      {formError && (
        <p role="alert" className="text-sm font-medium text-danger">
          {formError}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={pending}>
          Guardar cambios
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={resetForm}
          disabled={pending}
        >
          Descartar cambios
        </Button>
      </div>
    </form>
  );
}
