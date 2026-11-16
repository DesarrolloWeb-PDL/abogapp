import type { ReactNode } from "react";
import { AuthGuard } from "@/components/shell/auth-guard";
import { AppShell } from "@/components/shell/app-shell";
import { ToastProvider } from "@/components/ui/toast";

/**
 * Authenticated area: guard + app shell (sidebar / mobile bottom bar) +
 * toast host. The guard resolves the session through the data layer's
 * driver switch (fake localStorage / Supabase SSR cookies); `proxy.ts`
 * refreshes the session and redirects first, so server-side checks are in
 * place for both drivers.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <ToastProvider>
        <AppShell>{children}</AppShell>
      </ToastProvider>
    </AuthGuard>
  );
}

// Opted out of Next 16 instant-navigation validation: this segment reads
// session/runtime data at request time (migration path per docs
// authentication-with-cache-components.md — remove route by route later).
export const instant = false;
