"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, LogOut } from "lucide-react";
import { MainNav } from "@/components/shell/main-nav";
import { NotificationBell } from "@/components/shell/notification-bell";
import { getMyStudy, getSession, signOut } from "@/lib/data";
import { seedStudy, seedUser } from "@/lib/seed";

/**
 * Desktop sidebar (components.md block 1): expanded 240px / collapsed 64px
 * icon-only, Cmd/Ctrl+B toggles it, active item via aria-current="page".
 * Below 768px the sidebar is replaced by the bottom bar (mobile shell).
 */

export function Sidebar() {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [identity, setIdentity] = useState({
    fullName: seedUser.fullName,
    studyName: seedStudy.name,
  });

  // Cmd/Ctrl+B toggles the sidebar (keyboard spec for block 1).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setCollapsed((prev) => !prev);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Real session identity (driver-switched); seed values are the demo
  // fallback shown while the read resolves.
  useEffect(() => {
    let cancelled = false;
    Promise.all([getSession(), getMyStudy()])
      .then(([session, study]) => {
        if (cancelled) return;
        setIdentity({
          fullName: session?.user.fullName || seedUser.fullName,
          studyName: study?.name ?? "Tu estudio",
        });
      })
      .catch(() => {
        // Keep the demo fallback: the guard already verified the session.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSignOut() {
    // Data-layer sign-out: clears the fake store/localStorage or the
    // Supabase session cookies, depending on the driver.
    await signOut();
    router.push("/login");
  }

  return (
    <aside
      className={[
        "hidden shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-base md:flex",
        collapsed ? "w-16" : "w-60",
      ].join(" ")}
    >
      <div
        className={
          collapsed
            ? "flex flex-col items-center gap-2 border-b border-border py-3"
            : "flex h-16 items-center justify-between gap-2 border-b border-border px-3"
        }
      >
        <Link
          href="/expedientes"
          aria-label="Ir al inicio"
          className="flex items-center gap-2 rounded-md px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent-tint text-base font-bold text-accent"
          >
            E
          </span>
          {!collapsed && (
            <span className="text-lg font-semibold text-text">Tu estudio</span>
          )}
        </Link>
        <NotificationBell />
      </div>

      <MainNav collapsed={collapsed} />

      <div className="mt-auto border-t border-border p-3">
        <div
          className={
            collapsed
              ? "flex justify-center"
              : "flex items-center gap-3"
          }
        >
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-pill bg-accent-tint text-sm font-semibold text-accent"
          >
            {identity.fullName
              .split(" ")
              .map((part) => part[0])
              .slice(0, 2)
              .join("")}
          </span>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-text">
                {identity.fullName}
              </p>
              <p className="truncate text-xs text-muted">{identity.studyName}</p>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          title={collapsed ? "Cerrar sesión" : undefined}
          aria-label={collapsed ? "Cerrar sesión" : undefined}
          className={[
            "mt-2 flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-sm text-text-muted",
            "hover:bg-accent-tint hover:text-text",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          ].join(" ")}
        >
          <LogOut aria-hidden="true" className="size-5 shrink-0" />
          {!collapsed && <span>Cerrar sesión</span>}
          {collapsed && <span className="sr-only">Cerrar sesión</span>}
        </button>

        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
          title={collapsed ? "Expandir menú (Ctrl+B)" : "Contraer menú (Ctrl+B)"}
          className={[
            "mt-1 flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-sm text-text-muted",
            "hover:bg-accent-tint hover:text-text",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          ].join(" ")}
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden="true" className="size-5 shrink-0" />
          ) : (
            <PanelLeftClose aria-hidden="true" className="size-5 shrink-0" />
          )}
          {!collapsed && <span>Contraer menú</span>}
          {collapsed && <span className="sr-only">Expandir menú</span>}
        </button>
      </div>
    </aside>
  );
}
