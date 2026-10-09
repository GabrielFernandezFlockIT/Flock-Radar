import { CircleAlertIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Project, SyncRun, SyncRunStatus, Severity } from "@/shared/domain";

import { formatAgo, formatDayWithYear, humanizeKey } from "../../shared/ui/format";
import { SYNC_SOURCE_LABELS, SYNC_STATUS_LABELS } from "../../shared/ui/labels";
import { HealthDot, healthFromSeverities } from "../../shared/ui/severity";

const STATUS_TONE: Readonly<Record<SyncRunStatus, string>> = {
  ok: "text-muted-foreground",
  running: "text-muted-foreground",
  partial: "text-amber-700 dark:text-amber-300",
  failed: "text-red-700 dark:text-red-300",
};

function SyncRunChip({ run, now }: { run: SyncRun; now: string }) {
  const label = SYNC_SOURCE_LABELS[run.source] ?? humanizeKey(run.source);
  const at = run.finishedAt ?? run.startedAt;
  const degraded = run.status === "partial" || run.status === "failed";

  const chip = (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap ${STATUS_TONE[run.status]}`}
    >
      {degraded ? <CircleAlertIcon className="size-3" aria-hidden="true" /> : null}
      <span className="font-medium text-foreground">{label}</span>
      <span>{run.status === "running" ? "sincronizando…" : formatAgo(at, now)}</span>
      {degraded ? <span>({SYNC_STATUS_LABELS[run.status]})</span> : null}
    </span>
  );

  if (!degraded) return chip;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{chip}</span>
      </TooltipTrigger>
      <TooltipContent>
        {run.error ??
          `La última sincronización de ${label} terminó de forma ${SYNC_STATUS_LABELS[run.status]}.`}
      </TooltipContent>
    </Tooltip>
  );
}

export function ProjectHeader({
  project,
  activeAlertSeverities,
  syncRuns,
  now,
}: {
  project: Project;
  activeAlertSeverities: readonly Severity[];
  syncRuns: readonly SyncRun[];
  now: string;
}) {
  const health = healthFromSeverities(activeAlertSeverities);

  return (
    <div className="mb-6 space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
        <HealthDot health={health} />
      </div>
      <p className="text-sm text-muted-foreground">
        {project.clientName} · <Badge variant="outline">{project.jiraKey}</Badge>{" "}
        <span className="font-mono text-xs">{project.githubRepo}</span> ·{" "}
        {formatDayWithYear(project.startDate)} – {formatDayWithYear(project.endDate)}
      </p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium">Actualidad de los datos</span>
        {syncRuns.length === 0 ? (
          <span>Todavía no se ejecutó ninguna sincronización para este proyecto.</span>
        ) : (
          syncRuns.map((run) => <SyncRunChip key={run.id} run={run} now={now} />)
        )}
      </p>
    </div>
  );
}
