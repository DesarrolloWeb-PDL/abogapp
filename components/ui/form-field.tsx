"use client";

import { useId } from "react";
import { Input, Select } from "@/components/ui/input";
import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";

/**
 * Form field group: label + control + hint/error with the a11y wiring done
 * once (htmlFor, aria-describedby, aria-invalid, role="alert" on the error).
 * Client component because it generates stable ids with useId.
 * The shared props are typed for <input>; the select branch reinterprets
 * them (the label/error wiring is identical for both controls).
 */

interface FormFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "children">,
    Pick<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  label: string;
  hint?: string;
  error?: string;
  /** Renders a native <select> instead of a text input. */
  as?: "input" | "select";
}

export function FormField({
  label,
  hint,
  error,
  children,
  as = "input",
  id,
  ...rest
}: FormFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={inputId}
        className="text-sm font-semibold text-text"
      >
        {label}
      </label>
      {as === "select" ? (
        <Select
          id={inputId}
          invalid={Boolean(error)}
          aria-describedby={describedBy || undefined}
          {...(rest as unknown as SelectHTMLAttributes<HTMLSelectElement>)}
        >
          {children}
        </Select>
      ) : (
        <Input
          id={inputId}
          invalid={Boolean(error)}
          aria-describedby={describedBy || undefined}
          {...rest}
        />
      )}
      {hint && !error && (
        <p id={hintId} className="text-sm text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
