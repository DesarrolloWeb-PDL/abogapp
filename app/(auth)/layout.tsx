import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Public area (login / signup / onboarding): centred card layout without the
 * app shell — no sidebar until the session exists.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-4 py-10">
      <Link
        href="/login"
        className="mb-6 flex items-center gap-2 rounded-md px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span
          aria-hidden="true"
          className="flex size-9 items-center justify-center rounded-md bg-accent-tint text-base font-bold text-accent"
        >
          E
        </span>
        <span className="text-lg font-semibold text-text">Tu estudio</span>
      </Link>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
