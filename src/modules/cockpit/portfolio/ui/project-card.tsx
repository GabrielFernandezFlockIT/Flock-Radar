import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

import type { PortfolioRow } from "../application/get-portfolio";
import {
  daysUntil,
  formatDay,
  formatDayDistance,
  formatPercent,
} from "../../shared/ui/format";
import {
  HealthDot,
  SeverityBadge,
  healthFromSeverities,
} from "../../shared/ui/severity";
import type { BudgetRunwayView } from "../../shared/domain/stored-forecast";

interface Runway {
  text: string;
  tone: "default" | "warning" | "danger";
  caption: string;
}

/** Days of budget left, or how long ago / how soon the money runs out. */
function describeRunway(budget: BudgetRunwayView | null): Runway {
  if (budget === null) {
    return { text: "—", tone: "default", caption: "Todavía no hay pronóstico de presupuesto" };
  }
  if (budget.exhaustionDate === null) {
    return {
      text: "Dentro del presupuesto",
      tone: "default",
      caption: budget.endDate
        ? `Hasta el ${formatDay(budget.endDate)}`
        : "No se proyecta agotamiento",
    };
  }

  const days = daysUntil(budget.asOf, budget.exhaustionDate);
  const beforeEnd = budget.daysBeforeEnd;
  const caption =
    beforeEnd !== null && beforeEnd > 0
      ? `${beforeEnd} días antes de la fecha de fin`
      : `Se agota el ${formatDay(budget.exhaustionDate)}`;

  if (budget.alreadyExhausted || (days !== null && days <= 0)) {
    return {
      text: days === null ? "Agotado" : `Agotado ${formatDayDistance(days)}`,
      tone: "danger",
      caption,
    };
  }

  return {
    text: days === null ? "—" : `Quedan ${days} días`,
    tone: days !== null && days <= 14 ? "warning" : "default",
    caption,
  };
}

const RUNWAY_TONE = {
  default: "text-foreground",
  warning: "text-amber-700 dark:text-amber-300",
  danger: "text-red-700 dark:text-red-300",
} as const;

function probabilityTone(probability: number): string {
  if (probability < 0.5) return "text-red-700 dark:text-red-300";
  if (probability < 0.75) return "text-amber-700 dark:text-amber-300";
  return "text-emerald-700 dark:text-emerald-300";
}

export function ProjectCard({ row, now }: { row: PortfolioRow; now: string }) {
  const { project, topAlert, sprint, openAlerts, activeAlerts } = row;
  const health = healthFromSeverities(activeAlerts.map((alert) => alert.severity));
  const runway = describeRunway(row.budget);
  const probability = sprint?.probability ?? null;
  const etaDays = topAlert?.eta ? daysUntil(now, topAlert.eta) : null;

  return (
    <Card className="group relative gap-0 transition-colors hover:border-ring/60">
      <CardHeader className="gap-1 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tracking-tight">
              <Link
                href={`/projects/${project.id}`}
                className="outline-none after:absolute after:inset-0 focus-visible:underline"
              >
                {project.name}
              </Link>
            </h2>
            <p className="truncate text-sm text-muted-foreground">
              {project.clientName} · {project.jiraKey}
            </p>
          </div>
          <HealthDot health={health} />
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p
              className={`text-3xl leading-none font-semibold tabular-nums ${
                probability === null ? "text-muted-foreground" : probabilityTone(probability)
              }`}
            >
              {probability === null ? "—" : formatPercent(probability)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              P(cumplir el objetivo del sprint)
            </p>
          </div>
          <div>
            <p
              className={`text-base leading-tight font-semibold ${RUNWAY_TONE[runway.tone]}`}
            >
              {runway.text}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Autonomía presupuestaria</p>
            <p className="text-xs text-muted-foreground/80">{runway.caption}</p>
          </div>
        </div>

        <Separator />

        {topAlert === null ? (
          <p className="text-sm text-muted-foreground">Sin alertas abiertas.</p>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <SeverityBadge severity={topAlert.severity} />
              <span className="text-xs text-muted-foreground">
                {topAlert.eta === null
                  ? "Sin ETA"
                  : `ETA ${formatDay(topAlert.eta)}${
                      etaDays === null ? "" : ` · ${formatDayDistance(etaDays)}`
                    }`}
              </span>
              {openAlerts.length > 1 ? (
                <span className="ml-auto text-xs text-muted-foreground">
                  +{openAlerts.length - 1} más
                </span>
              ) : null}
            </div>
            <p className="line-clamp-2 text-sm">{topAlert.title}</p>
          </div>
        )}

        <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
          Abrir proyecto
          <ChevronRightIcon className="size-3.5" aria-hidden="true" />
        </p>
      </CardContent>
    </Card>
  );
}
