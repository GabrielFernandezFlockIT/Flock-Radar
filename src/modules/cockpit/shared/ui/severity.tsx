import { cn } from "@/lib/utils";
import type { Severity } from "@/shared/domain";

import { SEVERITY_LABELS } from "./labels";

/**
 * Severity presentation.
 *
 * Colour is never the only signal: the badge always spells the severity out,
 * and the health dot carries a text label next to it. Each palette is tuned
 * for both themes (the app follows the OS preference, see globals.css).
 */

const SEVERITY_BADGE: Readonly<Record<Severity, string>> = {
  critical:
    "border-red-600/40 bg-red-600/10 text-red-700 dark:border-red-400/40 dark:bg-red-400/15 dark:text-red-300",
  high: "border-orange-600/40 bg-orange-500/10 text-orange-700 dark:border-orange-400/40 dark:bg-orange-400/15 dark:text-orange-300",
  medium:
    "border-amber-600/40 bg-amber-500/10 text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/15 dark:text-amber-200",
  low: "border-sky-600/40 bg-sky-500/10 text-sky-700 dark:border-sky-400/40 dark:bg-sky-400/15 dark:text-sky-300",
};

export function SeverityBadge({
  severity,
  className,
}: {
  severity: Severity;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-4xl border px-2 text-xs font-medium whitespace-nowrap",
        SEVERITY_BADGE[severity],
        className,
      )}
    >
      {SEVERITY_LABELS[severity]}
    </span>
  );
}

/** Portfolio health, derived from the open alerts of a project. */
export type Health = "red" | "amber" | "green";

const HEALTH_DOT: Readonly<Record<Health, string>> = {
  red: "bg-red-600 dark:bg-red-400",
  amber: "bg-amber-500 dark:bg-amber-400",
  green: "bg-emerald-600 dark:bg-emerald-400",
};

const HEALTH_LABEL: Readonly<Record<Health, string>> = {
  red: "En riesgo",
  amber: "Atención",
  green: "En curso",
};

export function healthLabel(health: Health): string {
  return HEALTH_LABEL[health];
}

/**
 * `red` when an open alert is critical or high, `amber` when one is medium or
 * low, `green` when nothing is open.
 */
export function healthFromSeverities(
  severities: readonly Severity[],
): Health {
  if (severities.some((severity) => severity === "critical" || severity === "high")) {
    return "red";
  }
  return severities.length > 0 ? "amber" : "green";
}

export function HealthDot({
  health,
  withLabel = true,
  className,
}: {
  health: Health;
  withLabel?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        aria-hidden="true"
        className={cn("size-2.5 shrink-0 rounded-full", HEALTH_DOT[health])}
      />
      <span className={cn("text-xs font-medium", !withLabel && "sr-only")}>
        {HEALTH_LABEL[health]}
      </span>
    </span>
  );
}
