import { LineChartIcon } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import type {
  BudgetRunwayView,
  SprintCompletionView,
} from "../../shared/domain/stored-forecast";
import {
  daysUntil,
  formatDayWithYear,
  formatMoney,
  formatNumber,
  formatPercent,
} from "../../shared/ui/format";
import { FORECAST_UNIT_LABELS } from "../../shared/ui/labels";
import { StatTile } from "../../shared/ui/stat-tile";
import { BudgetChart } from "./budget-chart";
import { BurnUpChart } from "./burn-up-chart";

/**
 * Forecast tab: the sprint burn-up with its P50/P85 cone, then the budget
 * burn against plan. Every series is optional in the persisted document, so
 * each chart falls back to a one-line note rather than rendering empty axes.
 */

function probabilityTone(probability: number | null) {
  if (probability === null) return "default" as const;
  if (probability < 0.5) return "danger" as const;
  if (probability < 0.75) return "warning" as const;
  return "positive" as const;
}

function SprintSection({ sprint }: { sprint: SprintCompletionView }) {
  const unit = FORECAST_UNIT_LABELS[sprint.unit];
  const hasBurnUp = sprint.burnUp.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Avance acumulado del sprint</CardTitle>
        <CardDescription>
          {sprint.sprint?.name
            ? `${sprint.sprint.name} · ${formatNumber(sprint.done, 1)} de ${formatNumber(
                sprint.scope,
                1,
              )} ${unit} completadas`
            : "Sin sprint activo"}
          {sprint.unitFallback
            ? " · se cuentan incidencias porque faltan estimaciones"
            : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="P(cumplir el objetivo del sprint)"
            value={
              sprint.probability === null ? "—" : formatPercent(sprint.probability)
            }
            caption={`${formatNumber(sprint.remaining, 1)} ${unit} restantes`}
            tone={probabilityTone(sprint.probability)}
          />
          <StatTile
            label="Finalización P50"
            value={sprint.p50Date === null ? "—" : formatDayWithYear(sprint.p50Date)}
            caption="La mitad de las simulaciones termina para esta fecha"
          />
          <StatTile
            label="Finalización P85"
            value={sprint.p85Date === null ? "—" : formatDayWithYear(sprint.p85Date)}
            caption="Una fecha de cierre confiable"
          />
          <StatTile
            label="Días hábiles restantes"
            value={formatNumber(sprint.remainingWorkingDays)}
            caption={
              sprint.sprint?.endDate
                ? `El sprint termina el ${formatDayWithYear(sprint.sprint.endDate)}`
                : "Sin ventana de sprint"
            }
          />
        </div>

        {hasBurnUp ? (
          <BurnUpChart points={sprint.burnUp} unit={unit} />
        ) : (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            El último pronóstico no incluye la serie de avance acumulado.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function BudgetSection({ budget }: { budget: BudgetRunwayView }) {
  const hasSeries = budget.series.length > 0;
  const daysLeft =
    budget.exhaustionDate === null ? null : daysUntil(budget.asOf, budget.exhaustionDate);
  const exhausted = budget.alreadyExhausted || (daysLeft !== null && daysLeft <= 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Consumo del presupuesto</CardTitle>
        <CardDescription>
          {formatMoney(budget.spent, budget.currency)} de{" "}
          {formatMoney(budget.budget, budget.currency)} consumidos ·{" "}
          {formatNumber(budget.spentHours)} horas registradas
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Autonomía"
            value={
              budget.exhaustionDate === null
                ? "Dentro del presupuesto"
                : exhausted
                  ? "Agotado"
                  : `${daysLeft} días`
            }
            caption={
              budget.exhaustionDate === null
                ? "No se proyecta agotamiento antes de la fecha de fin"
                : `Proyectado para el ${formatDayWithYear(budget.exhaustionDate)}`
            }
            tone={exhausted ? "danger" : daysLeft !== null && daysLeft <= 14 ? "warning" : "default"}
          />
          <StatTile
            label="Restante"
            value={formatMoney(budget.remaining, budget.currency)}
            caption={`Consumo de ${formatMoney(budget.dailyBurn, budget.currency)} por día hábil`}
            tone={budget.remaining <= 0 ? "danger" : "default"}
          />
          <StatTile
            label="Proyectado a la fecha de fin"
            value={formatMoney(budget.projectedSpendAtEnd, budget.currency)}
            caption={
              budget.percentOverAtEnd === null
                ? `Termina el ${budget.endDate ? formatDayWithYear(budget.endDate) : "—"}`
                : `${budget.percentOverAtEnd > 0 ? "+" : ""}${formatNumber(
                    budget.percentOverAtEnd,
                    1,
                  )}% respecto del presupuesto`
            }
            tone={
              budget.percentOverAtEnd !== null && budget.percentOverAtEnd > 0
                ? "danger"
                : "default"
            }
          />
          <StatTile
            label="Respecto de la fecha de fin"
            value={
              budget.daysBeforeEnd === null
                ? "—"
                : formatNumber(Math.abs(budget.daysBeforeEnd))
            }
            caption={
              budget.daysBeforeEnd === null
                ? "No se proyecta agotamiento"
                : budget.daysBeforeEnd > 0
                  ? "Días de anticipación con que se agota el presupuesto"
                  : "Días que el presupuesto supera la fecha de fin"
            }
            tone={
              budget.daysBeforeEnd !== null && budget.daysBeforeEnd > 0 ? "danger" : "default"
            }
          />
        </div>

        {hasSeries ? (
          <BudgetChart
            series={budget.series}
            currency={budget.currency}
            budget={budget.budget}
            exhaustionDate={budget.exhaustionDate}
          />
        ) : (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            El último pronóstico no incluye la serie de presupuesto.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function ForecastTab({
  sprint,
  budget,
}: {
  sprint: SprintCompletionView | null;
  budget: BudgetRunwayView | null;
}) {
  if (sprint === null && budget === null) {
    return (
      <EmptyState
        icon={LineChartIcon}
        title="Todavía no hay pronóstico"
        description="Los pronósticos se calculan en cada sincronización. Ejecute una sincronización para completar esta pestaña."
      />
    );
  }

  return (
    <div className="space-y-4">
      {sprint === null ? null : <SprintSection sprint={sprint} />}
      {budget === null ? null : <BudgetSection budget={budget} />}
    </div>
  );
}
