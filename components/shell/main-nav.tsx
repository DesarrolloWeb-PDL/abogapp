"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { Bell, FolderOpen, MessageSquare, type LucideIcon } from "lucide-react";
import { seedUnreadCount } from "@/lib/seed";

/**
 * M1 navigation subset: Expedientes, Bandeja WhatsApp and Notificaciones.
 * The full sidebar (Inicio, Tareas, Agenda…) arrives with later milestones.
 *
 * `usePathname` lives in a child component behind <Suspense> because this nav
 * renders from a shared layout above dynamic routes (/expedientes/[id]): with
 * cacheComponents, route hooks in a shared layout must sit inside a Suspense
 * boundary or the build fails (Next.js 16 docs).
 */

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

export const mainNavItems: NavItem[] = [
  { href: "/expedientes", label: "Expedientes", icon: FolderOpen },
  { href: "/bandeja", label: "Bandeja WhatsApp", icon: MessageSquare },
  {
    href: "/notificaciones",
    label: "Notificaciones",
    icon: Bell,
    badge: seedUnreadCount,
  },
];

interface NavListProps {
  activePath: string | null;
  collapsed: boolean;
}

function isActivePath(activePath: string | null, href: string): boolean {
  if (!activePath) return false;
  return activePath === href || activePath.startsWith(`${href}/`);
}

function NavList({ activePath, collapsed }: NavListProps) {
  return (
    <nav aria-label="Navegación principal" className="flex flex-col gap-1 px-3 py-4">
      <p className="px-2 pb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
        Principal
      </p>
      {mainNavItems.map((item) => {
        const active = isActivePath(activePath, item.href);
        const Icon = item.icon;
        const unread = item.badge ?? 0;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            title={collapsed ? item.label : undefined}
            aria-label={
              collapsed
                ? `${item.label}${unread > 0 ? `, ${unread} sin leer` : ""}`
                : undefined
            }
            className={[
              "relative flex min-h-11 items-center gap-3 rounded-md px-3 text-base transition-colors duration-fast",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              active
                ? "bg-accent-tint font-semibold text-accent"
                : "text-text-muted hover:bg-accent-tint hover:text-text",
            ].join(" ")}
          >
            <span className="relative shrink-0">
              <Icon aria-hidden="true" className="size-5" />
              {collapsed && unread > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -right-1 -top-1 size-2 rounded-pill bg-info"
                />
              )}
            </span>
            {!collapsed && <span className="truncate">{item.label}</span>}
            {collapsed && <span className="sr-only">{item.label}</span>}
            {!collapsed && unread > 0 && (
              <span className="ml-auto flex min-w-5 items-center justify-center rounded-pill bg-info px-1.5 text-xs font-semibold leading-5 text-on-accent">
                {unread > 9 ? "9+" : unread}
                <span className="sr-only"> sin leer</span>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/** Reads the current pathname and highlights the matching item. */
function ActiveNavList(props: Omit<NavListProps, "activePath">) {
  const pathname = usePathname();
  return <NavList activePath={pathname} {...props} />;
}

export function MainNav({ collapsed }: { collapsed: boolean }) {
  return (
    <Suspense fallback={<NavList activePath={null} collapsed={collapsed} />}>
      <ActiveNavList collapsed={collapsed} />
    </Suspense>
  );
}
