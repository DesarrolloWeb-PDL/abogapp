import type { ReactNode } from "react";
import { AuthGuard } from "@/components/shell/auth-guard";
import { AppShell } from "@/components/shell/app-shell";
import { ToastProvider } from "@/components/ui/toast";

/**
 * Authenticated area: guard + app shell (sidebar / mobile bottom bar) +
 * toast host. The guard is client-side over the fake session today;
 * server-side session checks arrive with Supabase (M2/backend).
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
