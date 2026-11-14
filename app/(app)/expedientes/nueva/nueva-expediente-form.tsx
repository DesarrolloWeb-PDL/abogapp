"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { useToast } from "@/components/ui/toast";
import { DataLayerError, ERROR_COPY, createCase, getMyStudy } from "@/lib/data";

/**
 * Manual case creation form (S07): validates, persists through the data
 * layer and lands on the new case's detail. The jurisdiction field is
 * prefilled from the wizard's step-1 selection when there is one.
 */
export function NuevaExpedienteForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [caratulaError, setCaratulaError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [jurisdiccion, setJurisdiccion] = useState("");

  useEffect(() => {
    let cancelled = false;
    getMyStudy().then((study) => {
      if (cancelled || !study) return;
      const first = study.jurisdictions[0];
      if (first) setJurisdiccion(first);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
