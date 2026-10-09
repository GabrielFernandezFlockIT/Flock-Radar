import {
  CalendarDaysIcon,
  FileTextIcon,
  GitCommitHorizontalIcon,
  GitPullRequestIcon,
  MessageSquareIcon,
  NotebookPenIcon,
  SquareCheckBigIcon,
  TimerIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { Driver, Evidence, EvidenceSourceType } from "@/shared/domain";

import { formatNumber, humanizeKey } from "./format";
import { SOURCE_TYPE_LABELS } from "./labels";

/**
 * "Evidence or it didn't happen": every claim links back to the record it was
 * built from. Chips open the source system in a new tab and carry the human
 * id (`BCN-123`, `#42`) plus the kind of record, so the label is readable
 * without the icon.
 */

const SOURCE_ICON: Readonly<Record<EvidenceSourceType, LucideIcon>> = {
  jira_issue: SquareCheckBigIcon,
  jira_transition: SquareCheckBigIcon,
  jira_comment: MessageSquareIcon,
  jira_worklog: TimerIcon,
  jira_sprint: CalendarDaysIcon,
  github_pr: GitPullRequestIcon,
  github_review: GitPullRequestIcon,
  github_commit: GitCommitHorizontalIcon,
  calendar_event: CalendarDaysIcon,
  doc: FileTextIcon,
  status: NotebookPenIcon,
};

export function EvidenceChip({ evidence }: { evidence: Evidence }) {
  const Icon = SOURCE_ICON[evidence.sourceType];
  const sourceLabel = SOURCE_TYPE_LABELS[evidence.sourceType];
  // Internal evidence (a daily status) is a root-relative app path: it opens
  // in place, not in a new tab.
  const internal = evidence.url.startsWith("/");

  return (
    <a
      href={evidence.url}
      {...(internal ? {} : { target: "_blank", rel: "noopener noreferrer" })}
      title={evidence.label ?? `${sourceLabel} ${evidence.externalId}`}
      className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-4xl border border-border bg-muted/40 px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      <span className="font-mono text-[0.7rem] text-foreground">
        {evidence.externalId}
      </span>
      <span className="truncate">{sourceLabel}</span>
    </a>
  );
}

export function EvidenceChips({
  evidence,
  className,
}: {
  evidence: readonly Evidence[];
  className?: string;
}) {
  if (evidence.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">Evidencia</span>
      {evidence.map((entry) => (
        <EvidenceChip
          key={`${entry.sourceType}-${entry.externalId}-${entry.url}`}
          evidence={entry}
        />
      ))}
    </div>
  );
}

/** The numbers a detector fired on, e.g. "Alcance agregado 13 pts". */
export function DriverChips({
  drivers,
  className,
}: {
  drivers: readonly Driver[];
  className?: string;
}) {
  if (drivers.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {drivers.map((driver) => (
        <span
          key={driver.key}
          title={driver.detail ?? driver.label}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <span className="truncate text-muted-foreground">
            {driver.label || humanizeKey(driver.key)}
          </span>
          <span className="font-mono text-[0.7rem] font-medium tabular-nums">
            {formatNumber(driver.value, Number.isInteger(driver.value) ? 0 : 1)}
            {driver.unit ? ` ${driver.unit}` : ""}
          </span>
        </span>
      ))}
    </div>
  );
}
