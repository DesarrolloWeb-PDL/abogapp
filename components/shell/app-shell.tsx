import type { ReactNode } from "react";
import { Sidebar } from "@/components/shell/sidebar";
import { MobileBottomBar, MobileHeader } from "@/components/shell/mobile-bar";

/**
 * App shell: collapsible sidebar (desktop) or header + bottom bar (mobile,
 * <768px), content area on the right. Works from 390px to 1440px wide.
 */

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <a
        href="#contenido"
        className="sr-only rounded-md bg-surface px-4 py-3 text-base font-semibold text-accent focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:ring-2 focus:ring-accent"
      >
        Ir al contenido
      </a>

      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader />
        <main id="contenido" className="flex-1 px-4 py-6 pb-24 md:px-8 md:pb-10">
          <div className="mx-auto flex w-full content-max flex-col gap-6">
            {children}
          </div>
        </main>
      </div>

      <MobileBottomBar />
    </div>
  );
}
