"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";

/**
 * Transient toast system (components.md block 7).
 *
 * - success toasts auto-dismiss after 4s, errors stay until dismissed
 * - max 3 visible (newest kept), Esc dismisses the top one
 * - role="status" (polite) for success/neutral, role="alert" for errors
 * - optional action button (e.g. "Deshacer") is a real focusable button
 */

export type ToastVariant = "success" | "error" | "neutral";

interface ToastOptions {
  variant?: ToastVariant;
  /** ms; 0 keeps the toast until dismissed. Defaults: 4000, errors persistent. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastOptions {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (message: string, options?: ToastOptions) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside a ToastProvider");
  }
  return context;
}

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  success: "bg-success-tint text-success border border-success",
  error: "bg-danger text-on-primary border border-danger",
  neutral: "bg-text text-on-primary border border-text",
};

const MAX_VISIBLE = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const variant = options.variant ?? "success";
      const duration = options.duration ?? (variant === "error" ? 0 : 4000);
      const id = nextId.current++;

      // Stack limit: keep the newest MAX_VISIBLE toasts.
      setItems((prev) => [
        ...prev.slice(-(MAX_VISIBLE - 1)),
        { id, message, variant, ...options },
      ]);

      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
    },
    [dismiss],
  );

  // Esc dismisses the top toast while any toast is visible.
  useEffect(() => {
    if (items.length === 0) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const top = items[items.length - 1];
      if (top) dismiss(top.id);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [items, dismiss]);

  // Clear every pending timer on unmount.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <div
        className="pointer-events-none fixed bottom-16 right-4 z-50 flex w-full max-w-90 flex-col gap-2 md:bottom-4"
        aria-live="polite"
      >
        {items.map((item) => (
          <div
            key={item.id}
            role={item.variant === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex min-h-11 items-center justify-between gap-3 rounded-md px-4 py-3 shadow-pop ${VARIANT_CLASSES[item.variant]}`}
          >
            <span className="text-sm font-medium">{item.message}</span>
            <div className="flex items-center gap-2">
              {item.action && (
                <button
                  type="button"
                  onClick={() => {
                    item.action?.onClick();
                    dismiss(item.id);
                  }}
                  className="rounded-md px-2 py-1 text-sm font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
                >
                  {item.action.label}
                </button>
              )}
              <button
                type="button"
                aria-label="Cerrar aviso"
                onClick={() => dismiss(item.id)}
                className="flex size-9 items-center justify-center rounded-md hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
