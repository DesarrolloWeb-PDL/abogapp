"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { getSession } from "@/lib/data";

/**
 * Client-side guard for the authed routes. Reads the session through the
 * data layer's driver switch: the fake demo checks its localStorage flag,
 * the Supabase driver reads the SSR session cookies. Server-side, `proxy.ts`
 * refreshes the session and redirects first — this guard is the second line
 * and the only one active while the fake driver runs without keys.
 *
 * While the session is unknown (first paint) it shows a skeleton — never a
 * spinner — and a missing session redirects to /login.
 */

type GuardStatus = "loading" | "authed" | "guest";

function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh">
      <div className="hidden w-60 shrink-0 flex-col gap-4 border-r border-border bg-surface p-4 md:flex">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
      <div className="flex flex-1 flex-col gap-6 p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}

export function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<GuardStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    getSession()
      .then((session) => {
        if (!cancelled) setStatus(session ? "authed" : "guest");
      })
      .catch(() => {
        if (!cancelled) setStatus("guest");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Redirect only from the effect: never during render.
  useEffect(() => {
    if (status === "guest") router.replace("/login");
  }, [status, router]);

  if (status !== "authed") return <ShellSkeleton />;
  return <>{children}</>;
}
