"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { ERROR_COPY, signIn } from "@/lib/data";
import { seedDemoPassword, seedUser } from "@/lib/seed";

/**
 * Login (S01): email + password against the fake data layer. Wrong
 * credentials surface a Spanish error (role="alert"); success opens the
 * session the auth guard reads and lands on the expedientes list.
 */
export function LoginForm() {
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
  }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");

    const errors: { email?: string; password?: string } = {};
    if (!email) errors.email = "Ingresá tu correo electrónico.";
    if (!password) errors.password = "Ingresá tu contraseña.";

    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setPending(true);
    try {
      const result = await signIn({ email, password });
      if (!result.ok) {
        setFormError(ERROR_COPY[result.error]);
        setPending(false);
        return;
      }
      router.push("/expedientes");
    } catch {
      setFormError("No pudimos ingresar. Revisá tu conexión e intentá de nuevo.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <FormField
        label="Correo electrónico"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="nombre@estudio.com.ar"
        required
        error={fieldErrors.email}
      />
      <FormField
        label="Contraseña"
        name="password"
        type="password"
        autoComplete="current-password"
        placeholder="Tu contraseña"
        required
        error={fieldErrors.password}
      />
      {formError && (
        <p role="alert" className="text-sm font-medium text-danger">
          {formError}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        {pending ? "Ingresando…" : "Iniciar sesión"}
      </Button>

      <p className="rounded-md border border-border bg-bg px-3 py-3 text-sm text-text-muted">
        Cuenta de prueba del demo:{" "}
        <span className="font-semibold text-text">{seedUser.email}</span> ·
        contraseña <span className="font-semibold text-text">{seedDemoPassword}</span>
      </p>

      <p className="text-center text-base text-text-muted">
        ¿Todavía no tenés cuenta?{" "}
        <Link
          href="/signup"
          className="font-semibold text-accent underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Creá una cuenta
        </Link>
      </p>
    </form>
  );
}
