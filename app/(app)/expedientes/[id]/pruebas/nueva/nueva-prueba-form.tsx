"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { createPrueba, DataLayerError, errorCopy } from "@/lib/data";
import { FECHA_EFECTIVA_MAX, FECHA_EFECTIVA_MIN } from "@/lib/data/errors";
import { seedCases } from "@/lib/seed";
import type { PlazoTipo, PruebaTipo } from "@/lib/types";

const PRUEBA_TIPOS: PruebaTipo[] = [
  "Documental",
  "Informativa",
  "Confesional",
  "Testimonial",
  "Pericial",
  "Otras",
];

const PLAZO_UNITS = [
  { value: "horas", label: "Horas" },
  { value: "corridos", label: "Días corridos" },
  { value: "habiles", label: "Días hábiles" },
];

/**
 * Add-prueba form (S12). The plazo group (unit + quantity) is captured here,
 * but the fecha límite is always produced by the data layer: this form never
 * computes a deadline (spec S5) — `createPrueba` feeds `lib/plazos` and the
 * screen only ever shows what the engine returns.
 */
export function NuevaPruebaForm({ caseId }: { caseId: string }) {
  const { toast } = useToast();
  const router = useRouter();
  const [plazoUnit, setPlazoUnit] = useState("habiles");
  const [saving, setSaving] = useState(false);
  const record = seedCases.find((item) => item.id === caseId);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const cantidadRaw = String(form.get("plazo_cantidad") ?? "").trim();
    const cantidad = Number.parseInt(cantidadRaw, 10);

    setSaving(true);
    try {
      await createPrueba({
        caseId,
        tipo: String(form.get("tipo") ?? "") as PruebaTipo,
        titulo: String(form.get("titulo") ?? ""),
        informante: String(form.get("informante") ?? ""),
        fechaEfectiva: String(form.get("fecha_efectiva") ?? ""),
        plazo:
          cantidadRaw && Number.isInteger(cantidad) && cantidad > 0
            ? { tipo: plazoUnit as PlazoTipo, cantidad }
            : undefined,
      });
      toast("Prueba guardada.", { variant: "success" });
      router.push(`/expedientes/${caseId}?tab=pruebas`);
    } catch (error) {
      const code = error instanceof DataLayerError ? error.code : null;
      toast(
        code
          ? errorCopy(code)
          : "No pudimos guardar la prueba. Probá otra vez.",
        { variant: "error" },
      );
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/expedientes/${caseId}?tab=pruebas`}
        className="inline-flex min-h-11 items-center gap-2 self-start rounded-md px-2 text-base font-semibold text-accent hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Volver al expediente
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-text">Agregar prueba</h1>
        <p className="text-base text-muted">{record?.caratula ?? "Expediente"}</p>
      </div>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <FormField
          label="Tipo de prueba"
          name="tipo"
          as="select"
          defaultValue="Informativa"
        >
          {PRUEBA_TIPOS.map((tipo) => (
            <option key={tipo} value={tipo}>
              {tipo}
            </option>
          ))}
        </FormField>

        <FormField
          label="Título"
          name="titulo"
          placeholder="Qué se está pidiendo"
          required
        />

        <FormField
          label="Informante"
          name="informante"
          placeholder="Persona o entidad que informa"
          hint="Si es una persona nueva, primero creala en Personas."
          required
        />

        <FormField
          label="Fecha efectiva"
          name="fecha_efectiva"
          type="date"
          // BUG-004: the picker and the data layer share one sane window;
          // the typed rejection still comes back as a toast on submit.
          min={FECHA_EFECTIVA_MIN}
          max={FECHA_EFECTIVA_MAX}
          hint="Cargá una fecha entre 01/01/1900 y 31/12/2100."
          required
        />

        <fieldset className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <legend className="px-1 text-sm font-semibold text-text">
            Plazo (opcional)
          </legend>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-text" id="unidad-plazo">
                Unidad
              </span>
              <div
                role="radiogroup"
                aria-labelledby="unidad-plazo"
                className="flex flex-col gap-2 sm:flex-row"
              >
                {PLAZO_UNITS.map((unit) => (
                  <label
                    key={unit.value}
                    className={[
                      "flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-base",
                      plazoUnit === unit.value
                        ? "border-accent bg-accent-tint text-accent"
                        : "border-input bg-surface text-text",
                    ].join(" ")}
                  >
                    <input
                      type="radio"
                      name="plazo_tipo"
                      value={unit.value}
                      checked={plazoUnit === unit.value}
                      onChange={() => setPlazoUnit(unit.value)}
                      className="size-4 accent-[var(--ds-accent)]"
                    />
                    {unit.label}
                  </label>
                ))}
              </div>
            </div>

            <label className="flex w-full flex-col gap-2 sm:max-w-32">
              <span className="text-sm font-semibold text-text">Cantidad</span>
              <Input
                type="number"
                name="plazo_cantidad"
                min={1}
                inputMode="numeric"
                placeholder="10"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-bg px-3 py-3">
            <span className="text-sm font-semibold text-text">Fecha límite</span>
            <span className="text-base text-muted">
              Se calcula al guardar, con el motor de plazos del estudio.
            </span>
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" size="lg" disabled={saving}>
            {saving ? "Guardando…" : "Guardar prueba"}
          </Button>
          <Button
            variant="ghost"
            size="lg"
            onClick={() => window.history.back()}
          >
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}
