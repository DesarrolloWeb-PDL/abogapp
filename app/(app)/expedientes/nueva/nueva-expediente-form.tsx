"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { useToast } from "@/components/ui/toast";
import {
  DataLayerError,
  ERROR_COPY,
  createCase,
  getSession,
  getMyStudy,
  listStages,
  type CaseStage,
} from "@/lib/data";
import type { StudyCase } from "@/lib/types";

/** Tipo vocabularies come from the StudyCase union — never invented here. */
const TIPO_OPTIONS: StudyCase["tipo"][] = ["Judicial", "Extrajudicial"];

/**
 * Manual case creation form (S07): validates, persists through the data
 * layer and lands on the new case's detail. Prefills come from the study:
 * jurisdiction (wizard step 1), the etapa options (case_stages rows) and
 * the responsable (the signed-in user's full name).
 */
export function NuevaExpedienteForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [caratulaError, setCaratulaError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [jurisdiccion, setJurisdiccion] = useState("");
  const [etapa, setEtapa] = useState("");
  const [etapas, setEtapas] = useState<CaseStage[]>([]);
  const [responsable, setResponsable] = useState("");
  const [prefillError, setPrefillError] = useState(false);
  // Bumped by "Reintentar" so the prefill effect runs again.
  const [reload, setReload] = useState(0);

  // Prefill from the study: jurisdiction, etapa options and responsable
  // default. A failed read must show an error with a retry instead of
  // silently leaving the fields empty.
  useEffect(() => {
    let cancelled = false;
    Promise.all([getMyStudy(), listStages(), getSession()])
      .then(([study, stages, session]) => {
        if (cancelled) return;
        const first = study?.jurisdictions[0];
        if (first) setJurisdiccion(first);
        setEtapas(stages);
        // A retry must not clobber what the user already typed.
        setResponsable((current) => current || session?.user.fullName || "");
      })
      .catch(() => {
        if (cancelled) return;
        setPrefillError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  function retryPrefill() {
    setPrefillError(false);
    setReload((count) => count + 1);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const caratula = String(data.get("caratula") ?? "").trim();

    if (!caratula) {
      setCaratulaError("Ingresá la carátula para identificar el expediente.");
      setFormError(null);
      return;
    }

    setCaratulaError(null);
    setFormError(null);
    setPending(true);

    try {
      const created = await createCase({
        caratula,
        numero: String(data.get("numero") ?? ""),
        fuero: String(data.get("fuero") ?? ""),
        jurisdiccion: String(data.get("jurisdiccion") ?? ""),
        juzgado: String(data.get("juzgado") ?? ""),
        etapa: String(data.get("etapa") ?? ""),
        tipo:
          String(data.get("tipo")) === "Extrajudicial"
            ? "Extrajudicial"
            : "Judicial",
        responsable: String(data.get("responsable") ?? ""),
      });
      toast("Expediente creado", { variant: "success" });
      router.push(`/expedientes/${created.id}`);
    } catch (error) {
      setFormError(
        error instanceof DataLayerError
          ? ERROR_COPY[error.code]
          : "No pudimos guardar el expediente. Intentá de nuevo.",
      );
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/expedientes"
        className="inline-flex min-h-11 items-center gap-2 self-start rounded-md px-2 text-base font-semibold text-accent hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Volver a expedientes
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-text">Nuevo expediente</h1>
        <p className="text-base text-text-muted">
          Cargá una causa a mano: al guardar, queda disponible para todo el
          estudio.
        </p>
      </div>

      {prefillError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3"
        >
          <p className="text-sm font-medium text-danger">
            No pudimos cargar los datos de tu estudio.
          </p>
          <Button variant="secondary" size="sm" onClick={retryPrefill}>
            Reintentar
          </Button>
        </div>
      )}

      <form onSubmit={onSubmit} noValidate className="flex max-w-2xl flex-col gap-5">
        <FormField
          label="Carátula"
          name="caratula"
          placeholder="Apellidos c/ Contraparte s/ materia"
          required
          error={caratulaError ?? undefined}
        />
        <FormField
          label="Número"
          name="numero"
          placeholder="45.213/2025"
          hint="Número de expediente del juzgado."
        />
        <FormField
          label="Fuero"
          name="fuero"
          placeholder="Civil y Comercial"
        />
        <FormField
          label="Juzgado"
          name="juzgado"
          placeholder="Juzgado Civil N° 12"
        />
        <FormField
          label="Jurisdicción"
          name="jurisdiccion"
          placeholder="Ciudad Autónoma de Buenos Aires"
          value={jurisdiccion}
          onChange={(event) => setJurisdiccion(event.target.value)}
        />
        <FormField
          as="select"
          label="Etapa"
          name="etapa"
          hint="Etapa procesal del expediente según tu estudio."
          value={etapa}
          onChange={(event) => setEtapa(event.target.value)}
        >
          <option value="">Sin etapa</option>
          {etapas.map((stage) => (
            <option key={stage.id} value={stage.name}>
              {stage.name}
            </option>
          ))}
        </FormField>
        <FormField
          as="select"
          label="Tipo"
          name="tipo"
          defaultValue="Judicial"
        >
          {TIPO_OPTIONS.map((tipo) => (
            <option key={tipo} value={tipo}>
              {tipo}
            </option>
          ))}
        </FormField>
        <FormField
          label="Responsable"
          name="responsable"
          placeholder="Nombre y apellido"
          hint="Quién lleva el expediente. Se muestra en los filtros del listado."
          value={responsable}
          onChange={(event) => setResponsable(event.target.value)}
        />

        {formError && (
          <p role="alert" className="text-sm font-medium text-danger">
            {formError}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" size="lg" loading={pending}>
            {pending ? "Guardando…" : "Crear expediente"}
          </Button>
          <Button variant="ghost" size="lg" onClick={() => router.back()}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}
