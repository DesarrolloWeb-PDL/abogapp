"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DataLayerError,
  ERROR_COPY,
  createStudy,
  getSession,
  updateProfile,
} from "@/lib/data";

/**
 * Onboarding wizard, steps 1–3 of 5 (S03; steps 4–5 arrive in M2).
 * Fresh copy — the reference product's step wording is not reused.
 *
 * Step 1 picks jurisdictions (stored on the study), step 2 keeps the signed
 * profile in sync, step 3 creates the studio via the data layer and lands on
 * the expedientes list. The finish path shows a skeleton, never a spinner.
 */

const JURISDICTIONS = [
  "Ciudad Autónoma de Buenos Aires",
  "Provincia de Buenos Aires",
  "Córdoba",
  "Santa Fe",
  "Mendoza",
  "Tucumán",
];

const STEP_TITLES = [
  "¿En qué jurisdicciones trabajás?",
  "Tu perfil",
  "Datos del estudio",
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [studyName, setStudyName] = useState("");
  const [profileErrors, setProfileErrors] = useState<{
    name?: string;
    email?: string;
  }>({});
  const [finishError, setFinishError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Prefill from the session created at sign-up; no session → back to login.
  useEffect(() => {
    let cancelled = false;
    getSession().then((session) => {
      if (cancelled) return;
      if (!session) {
        router.replace("/login");
        return;
      }
      setFullName(session.user.fullName);
      setEmail(session.user.email);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  function toggleJurisdiction(name: string) {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name],
    );
  }

  function confirmProfile() {
    const errors: { name?: string; email?: string } = {};
    if (!fullName.trim()) errors.name = "Ingresá tu nombre completo.";
    if (!EMAIL_PATTERN.test(email.trim())) errors.email = ERROR_COPY.invalid_email;

    setProfileErrors(errors);
    if (Object.keys(errors).length === 0) setStep(3);
  }

  async function finish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = studyName.trim();
    if (!name) {
      setFinishError("Poné un nombre para tu estudio.");
      return;
    }

    setFinishError(null);
    setCreating(true);
    try {
      const profile = await updateProfile({ fullName, email });
      if (!profile.ok) {
        setFinishError(ERROR_COPY[profile.error]);
        setCreating(false);
        return;
      }
      await createStudy({ name, jurisdictions: selected });
      router.push("/expedientes");
    } catch (error) {
      setFinishError(
        error instanceof DataLayerError
          ? ERROR_COPY[error.code]
          : "Algo salió mal al preparar tu estudio. Probá otra vez.",
      );
      setCreating(false);
    }
  }

  if (!ready) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Cargando tu perfil">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-40" />
      </div>
    );
  }

  if (creating) {
    return (
      <div
        className="flex flex-col gap-4"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <p className="text-base font-semibold text-text">
          Preparando tu estudio…
        </p>
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-medium text-text-muted">Paso {step} de 3</p>
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-pill bg-border"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={3}
          aria-valuenow={step}
          aria-label="Progreso de la configuración inicial"
        >
          <div
            className="h-full rounded-pill bg-accent transition-[width] duration-base"
            style={{ width: `${(step / 3) * 100}%` }}
          />
        </div>
      </div>

      <h1 className="text-xl font-bold text-text">{STEP_TITLES[step - 1]}</h1>

      {step === 1 && (
        <section className="flex flex-col gap-4">
          <p className="text-base text-text-muted">
            Elegí las jurisdicciones donde llevás causas. Las usamos para
            preparar tus plazos y feriados.
          </p>
          <fieldset>
            <legend className="sr-only">Jurisdicciones</legend>
            <ul className="flex flex-col gap-2">
              {JURISDICTIONS.map((name) => (
                <li key={name}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border-input bg-surface px-3 text-base text-text hover:bg-accent-tint focus-within:ring-2 focus-within:ring-accent">
                    <input
                      type="checkbox"
                      checked={selected.includes(name)}
                      onChange={() => toggleJurisdiction(name)}
                      className="size-4 accent-[var(--ds-accent)]"
                    />
                    {name}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" onClick={() => setStep(2)}>
              Continuar
            </Button>
            <Button variant="ghost" size="lg" onClick={() => setStep(2)}>
              Saltar este paso
            </Button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="flex flex-col gap-4">
          <p className="text-base text-text-muted">
            Así te vamos a mostrar dentro del estudio y en los avisos que
            reciba el equipo.
          </p>
          <FormField
            label="Nombre completo"
            name="name"
            autoComplete="name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            error={profileErrors.name}
            required
          />
          <FormField
            label="Correo electrónico"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={profileErrors.email}
            required
          />
          <div className="flex flex-wrap gap-3">
            <Button size="lg" onClick={confirmProfile}>
              Continuar
            </Button>
            <Button variant="ghost" size="lg" onClick={() => setStep(1)}>
              Atrás
            </Button>
          </div>
        </section>
      )}

      {step === 3 && (
        <form onSubmit={finish} noValidate className="flex flex-col gap-5">
          <p className="text-base text-text-muted">
            Último paso: con estos datos creamos tu estudio.
          </p>
          <FormField
            label="Nombre del estudio"
            name="study_name"
            placeholder="Estudio García & Asociados"
            hint={
              selected.length > 0
                ? `Jurisdicciones: ${selected.join(", ")}.`
                : "Lo podés completar más tarde."
            }
            required
            onChange={(event) => setStudyName(event.target.value)}
          />
          {finishError && (
            <p role="alert" className="text-sm font-medium text-danger">
              {finishError}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" size="lg">
              Crear estudio
            </Button>
            <Button variant="ghost" size="lg" onClick={() => setStep(2)}>
              Atrás
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
