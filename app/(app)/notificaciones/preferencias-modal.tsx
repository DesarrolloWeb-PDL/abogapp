"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  NOTIFICATION_CATEGORIES,
  listNotificationPreferences,
  updateNotificationPreference,
  type NotificationPreference,
} from "@/lib/data";

/**
 * S21 "Preferencias" dialog: one group per DB category with an in-app and
 * an email toggle, saved through the data layer (which validates first and
 * warms the emission gate's cache).
 *
 * Honesty rules baked into the copy:
 * - in-app pausing says exactly what happens: no NEW notifications of that
 *   category (rows already in the list stay);
 * - the email flag persists because the column exists, but mail is not
 *   sent yet — the description says delivery arrives with Resend (F06
 *   digest), never that it is running;
 * - the `push` column exists too but has no delivery path at all, so no
 *   push toggle is offered (web push stays a "could" in features.csv).
 */

type PreferenceDraft = Record<string, { inApp: boolean; email: boolean }>;

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready" };

interface PreferenciasModalProps {
  open: boolean;
  onClose: () => void;
}

export function PreferenciasModal({ open, onClose }: PreferenciasModalProps) {
  const { toast } = useToast();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [prefs, setPrefs] = useState<NotificationPreference[]>([]);
  const [draft, setDraft] = useState<PreferenceDraft>({});
  const [saving, setSaving] = useState(false);

  const readPrefs = useCallback(() => {
    listNotificationPreferences()
      .then((rows) => {
        setPrefs(rows);
        setDraft(
          Object.fromEntries(
            rows.map((row) => [
              row.category,
              { inApp: row.inApp, email: row.email },
            ]),
          ),
        );
        setState({ status: "ready" });
      })
      .catch(() => setState({ status: "error" }));
  }, []);

  // Re-read every time the dialog opens: another tab may have changed a
  // row since the last visit. The effect only starts the read (state
  // resolves in the promise callbacks — react-hooks/set-state-in-effect);
  // the skeleton comes from the reset on close below.
  useEffect(() => {
    if (open) readPrefs();
  }, [open, readPrefs]);

  // Every close path (Cancelar, Esc, overlay, saved) parks the dialog on
  // the loading state so the next open always starts from the skeleton.
  function close() {
    setState({ status: "loading" });
    onClose();
  }

  /** Reintentar (event handler: a sync setState here is allowed). */
  function load() {
    setState({ status: "loading" });
    readPrefs();
  }

  function toggle(
    category: string,
    channel: "inApp" | "email",
    checked: boolean,
  ) {
    setDraft((prev) => ({
      ...prev,
      [category]: { ...prev[category], [channel]: checked },
    }));
  }

  async function save() {
    if (state.status !== "ready") return;
    setSaving(true);
    try {
      for (const category of NOTIFICATION_CATEGORIES) {
        const before = prefs.find((row) => row.category === category.value);
        const after = draft[category.value];
        if (!before || !after) continue;
        if (after.inApp !== before.inApp) {
          await updateNotificationPreference(category.value, "in_app", after.inApp);
        }
        if (after.email !== before.email) {
          await updateNotificationPreference(category.value, "email", after.email);
        }
      }
      toast("Listo: guardamos tus preferencias.");
      close();
    } catch {
      toast("No pudimos guardar tus preferencias.", { variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Preferencias de notificaciones"
      description="Elegís qué querés recibir en la app. El envío por email llega con Resend."
      busy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={saving}>
            Cancelar
          </Button>
          <Button
            onClick={() => void save()}
            loading={saving}
            disabled={state.status !== "ready"}
          >
            Guardar preferencias
          </Button>
        </>
      }
    >
      {state.status === "loading" && <SkeletonRows rows={4} />}

      {state.status === "error" && (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <p className="text-base text-muted">
            No pudimos cargar tus preferencias.
          </p>
          <Button variant="secondary" onClick={load}>
            Reintentar
          </Button>
        </div>
      )}

      {state.status === "ready" && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Si pausás una categoría, no vas a recibir notificaciones nuevas de
            esa categoría en la app. Las que ya tenés siguen en la lista.
          </p>
          {NOTIFICATION_CATEGORIES.map((category) => {
            const value = draft[category.value];
            if (!value) return null;
            return (
              <div
                key={category.value}
                role="group"
                aria-label={category.label}
                className="flex flex-col gap-1"
              >
                <p className="text-sm font-semibold text-text">
                  {category.label}
                </p>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-base text-text">
                  <input
                    type="checkbox"
                    className="size-4 accent-accent"
                    checked={value.inApp}
                    onChange={(event) =>
                      toggle(category.value, "inApp", event.target.checked)
                    }
                  />
                  En la app
                </label>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-base text-text">
                  <input
                    type="checkbox"
                    className="size-4 accent-accent"
                    checked={value.email}
                    onChange={(event) =>
                      toggle(category.value, "email", event.target.checked)
                    }
                  />
                  Email
                </label>
                {!value.inApp && (
                  <p className="text-sm text-muted">
                    No vas a recibir notificaciones nuevas de esta categoría.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
