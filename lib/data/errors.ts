/**
 * Typed error codes for the fake data layer.
 *
 * Codes are English (code vocabulary); `ERROR_COPY` carries the Argentine
 * Spanish text the screens display. Both survive the swap to the real
 * Supabase/Drizzle layer: the network layer maps its failures onto these
 * codes and no screen changes.
 */

export type DataErrorCode =
  /** No session when an authenticated call was made. */
  | "not_signed_in"
  /** The signed-in user has not finished the onboarding wizard yet. */
  | "no_study"
  /** Required input missing or blank. */
  | "missing_fields"
  /** Email fails a basic format check. */
  | "invalid_email"
  /** Password shorter than the 8-character floor. */
  | "weak_password"
  /** Sign-up with an email that already exists. */
  | "email_taken"
  /** Sign-in with unknown email or mismatched password. */
  | "invalid_credentials"
  /** Plazo quantity outside the engine's 1..5000 bound. */
  | "invalid_plazo"
  /** Supabase Auth created the account but returned no session: the user
   *  must click the verification link before signing in. */
  | "confirmation_pending"
  /** Sign-in attempted before the email verification link was clicked. */
  | "email_not_confirmed"
  /** Auth rate limit hit (Supabase built-in protection or upstream WAF). */
  | "too_many_requests"
  /** A server-side operation failed (network, RLS or constraint). */
  | "save_failed";

/** Spanish copy for every data-layer code (UI copy, fresh wording). */
export const ERROR_COPY: Record<DataErrorCode, string> = {
  not_signed_in: "Ingresá a tu cuenta para continuar.",
  no_study: "Primero terminá la configuración de tu estudio.",
  missing_fields: "Completá todos los campos para continuar.",
  invalid_email: "Revisá el formato del correo electrónico.",
  weak_password: "La contraseña necesita al menos 8 caracteres.",
  email_taken:
    "Ese correo ya está registrado. Si ya tenés una cuenta, ingresá con esa dirección.",
  invalid_credentials:
    "El correo y la contraseña no coinciden. Revisalos e intentá otra vez.",
  invalid_plazo: "La cantidad del plazo tiene que estar entre 1 y 5000.",
  confirmation_pending:
    "Te enviamos un correo para confirmar tu cuenta. Revisá tu bandeja y hacé clic en el enlace.",
  email_not_confirmed:
    "Todavía no confirmaste tu correo. Revisá tu bandeja y hacé clic en el enlace que te mandamos.",
  too_many_requests:
    "Demasiados intentos en poco tiempo. Esperá un momento y probá otra vez.",
  save_failed: "No pudimos completar la operación. Probá otra vez en unos minutos.",
};

/** Failure raised by data-layer functions outside the auth outcome union. */
export class DataLayerError extends Error {
  readonly code: DataErrorCode;

  constructor(code: DataErrorCode) {
    super(code);
    this.name = "DataLayerError";
    this.code = code;
  }
}

/** Spanish message for a caught data-layer failure. */
export function errorCopy(code: DataErrorCode): string {
  return ERROR_COPY[code];
}
