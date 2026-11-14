"use client";

import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { readDemoSession } from "@/lib/auth-stub";

/**
 * Client-side guard for the authed routes. It only reads the fake layer's
 * session flag today — real server-side verification arrives with Supabase
 * (M2/backend) and replaces this stub.
 *
 * The session flag is an external store (localStorage), read with
 * useSyncExternalStore so the first client render can decide without a
 * setState-in-effect cascade. While the value is unknown (SSR / hydration)
 * it shows a skeleton — never a spinner — and a missing session redirects
 * to /login.
 */

const subscribe = () => () => {};

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
  const session = useSyncExternalStore(subscribe, readDemoSession, () => null);

  // Read the store fresh when the effect runs: React may run this effect from
  // the hydration render (server snapshot = null) before the client snapshot
  // lands, so a stale closure value must not decide the redirect.
  useEffect(() => {
    if (readDemoSession() === null) router.replace("/login");
  }, [router, session]);

  if (session === null) return <ShellSkeleton />;
  return <>{children}</>;
}
