"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { ERROR_COPY, signUp } from "@/lib/data";

/**
 * Sign-up (S02): full name + email + password, no credit card, no Google
 * (those arrive with M4). Validation runs here for instant feedback and the
 * data layer repeats it server-side (shared rules in lib/data/auth.ts) — the
 * client is never trusted alone.
 *
 * With Supabase Auth + email verification, a successful sign-up that returns
 * no session shows a "check your inbox" notice (role="status") instead of an
 * error: the account exists, the confirmation link is what finishes it.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
}

export function SignupForm() {
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const fullName = String(data.get("name") ?? "").trim();
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");

    const errors: FieldErrors = {};
    if (!fullName) errors.name = "Ingresá tu nombre completo.";
    if (!email) {
      errors.email = "Ingresá tu correo electrónico.";
    } else if (!EMAIL_PATTERN.test(email)) {
      errors.email = ERROR_COPY.invalid_email;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      errors.password = ERROR_COPY.weak_password;
    }

    setFieldErrors(errors);
    setFormError(null);
    setNotice(null);
    if (Object.keys(errors).length > 0) return;

    setPending(true);
    try {
      const result = await signUp({ fullName, email, password });
      if (!result.ok) {
        if (result.error === "confirmation_pending") {
          // Account created: the verification email is the next step.
          setNotice(ERROR_COPY[result.error]);
          setPending(false);
          return;
        }
        setFormError(ERROR_COPY[result.error]);
        setPending(false);
        return;
      }
      // Signed in: continue into the onboarding wizard, like production.
      router.push("/onboarding");
    } catch {
      setFormError("No pudimos crear tu cuenta. Revisá tu conexión e intentá de nuevo.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <FormField
        label="Nombre completo"
        name="name"
        autoComplete="name"
        placeholder="Cómo te llamás"
        required
        error={fieldErrors.name}
      />
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
        autoComplete="new-password"
        placeholder="Mínimo 8 caracteres"
        hint="Usá al menos 8 caracteres."
        required
        error={fieldErrors.password}
      />
      {notice && (
        <p role="status" className="rounded-md border border-border bg-bg px-3 py-3 text-sm font-medium text-text">
          {notice}
        </p>
      )}
      {formError && (
        <p role="alert" className="text-sm font-medium text-danger">
          {formError}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        {pending ? "Creando tu cuenta…" : "Crear cuenta"}
      </Button>

      <p className="text-center text-base text-text-muted">
        ¿Ya tenés una cuenta?{" "}
        <Link
          href="/login"
          className="font-semibold text-accent underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Ingresá
        </Link>
      </p>
      <p className="text-center text-sm text-text-muted">
        Al continuar aceptás los términos de uso y la política de privacidad
        del estudio.
      </p>
    </form>
  );
}
