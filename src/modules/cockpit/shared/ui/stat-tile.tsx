import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** A dense label / big-number / caption tile, used across the cockpit. */
export function StatTile({
  label,
  value,
  caption,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  tone?: "default" | "warning" | "danger" | "positive";
  className?: string;
}) {
  const valueTone = {
    default: "text-foreground",
    warning: "text-amber-700 dark:text-amber-300",
    danger: "text-red-700 dark:text-red-300",
    positive: "text-emerald-700 dark:text-emerald-300",
  }[tone];

  return (
    <div className={cn("rounded-lg border border-border bg-card p-3", className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", valueTone)}>
        {value}
      </p>
      {caption ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{caption}</p>
      ) : null}
    </div>
  );
}
