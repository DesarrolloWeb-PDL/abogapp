/**
 * Skeleton loader (components.md block 4: "loading (skeleton rows, not
 * spinners)"). Purely decorative — always hidden from assistive tech; loading
 * state is announced by the container via aria-busy instead.
 */

interface SkeletonProps {
  /** Tailwind size classes, e.g. "h-4 w-40". */
  className?: string;
}

export function Skeleton({ className = "h-4 w-full" }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-border ${className}`}
    />
  );
}

/** Row-shaped skeleton for lists and tables. */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}
