import type { HTMLAttributes, ReactNode } from "react";

/**
 * Card primitive: border-led surface (flat system, shadow only for overlays).
 */

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ className, children, ...rest }: CardProps) {
  const classes = [
    "rounded-lg border border-border bg-surface shadow-card",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title: string;
  description?: string;
  /** Rendered on the right side of the header (actions, counts…). */
  action?: ReactNode;
}

export function CardHeader({ title, description, action }: CardHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-text">{title}</h2>
        {description && (
          <p className="text-sm text-text-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, children, ...rest }: CardProps) {
  const classes = ["px-5 py-4", className].filter(Boolean).join(" ");
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
