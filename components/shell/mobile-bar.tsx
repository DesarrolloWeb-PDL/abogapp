"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { Bell, FolderOpen, MessageSquare } from "lucide-react";
import { NotificationBell } from "@/components/shell/notification-bell";
import { useUnreadCount } from "@/components/shell/use-unread-count";

/**
 * Mobile shell (<768px, recon S38): a top bar with brand + bell and a
 * bottom bar replacing the sidebar. Same Suspense pattern as MainNav for
 * usePathname in a shared layout above dynamic routes.
 */

interface BottomItem {
  href: string;
  label: string;
  icon: typeof FolderOpen;
  /** Marks the entry whose badge shows the unread notification count. */
  showsUnread?: boolean;
}

const bottomItems: BottomItem[] = [
  { href: "/expedientes", label: "Expedientes", icon: FolderOpen },
  { href: "/bandeja", label: "Bandeja", icon: MessageSquare },
  {
    href: "/notificaciones",
    label: "Avisos",
    icon: Bell,
    showsUnread: true,
  },
];

export function MobileHeader() {
  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-surface px-4 md:hidden">
      <Link
        href="/expedientes"
        className="flex items-center gap-2 rounded-md px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span
          aria-hidden="true"
          className="flex size-9 items-center justify-center rounded-md bg-accent-tint text-base font-bold text-accent"
        >
          E
        </span>
        <span className="text-lg font-semibold text-text">Tu estudio</span>
      </Link>
      <NotificationBell />
    </header>
  );
}

function BottomItems({ activePath }: { activePath: string | null }) {
  const count = useUnreadCount();

  return (
    <nav
      aria-label="Navegación principal"
      className="flex h-full items-stretch"
    >
      {bottomItems.map((item) => {
        const active =
          activePath === item.href || activePath?.startsWith(`${item.href}/`);
        const Icon = item.icon;
        const unread = item.showsUnread ? count : 0;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={[
              "flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-base",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
              active
                ? "font-semibold text-accent"
                : "text-text-muted hover:text-text",
            ].join(" ")}
          >
            <span className="relative">
              <Icon aria-hidden="true" className="size-5" />
              {unread > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -right-1.5 -top-1 size-2 rounded-pill bg-info"
                />
              )}
            </span>
            <span className="truncate">{item.label}</span>
            {unread > 0 && <span className="sr-only">{unread} sin leer</span>}
          </Link>
        );
      })}
    </nav>
  );
}

function ActiveBottomItems() {
  const pathname = usePathname();
  return <BottomItems activePath={pathname} />;
}

export function MobileBottomBar() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 min-h-14 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
      <Suspense fallback={<BottomItems activePath={null} />}>
        <ActiveBottomItems />
      </Suspense>
    </div>
  );
}
