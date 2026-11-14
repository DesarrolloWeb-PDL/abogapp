import type { ReactNode } from "react";
import { AuthGuard } from "@/components/shell/auth-guard";
import { AppShell } from "@/components/shell/app-shell";
import { ToastProvider } from "@/components/ui/toast";

/**
 * Authenticated area: guard + app shell (sidebar / mobile bottom bar) +
 * toast host. Real session checks replace the stub in T4.
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
