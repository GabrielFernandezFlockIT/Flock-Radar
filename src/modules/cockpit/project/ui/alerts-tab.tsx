import { BellIcon } from "lucide-react";

import { EmptyState } from "@/components/app-shell/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ALERT_STATUS_TRANSITIONS, type Alert, type AlertStatus } from "@/shared/domain";

import { DriverChips, EvidenceChips } from "../../shared/ui/evidence-chips";
import {
  daysUntil,
  formatDay,
  formatDayDistance,
  formatPercent,
} from "../../shared/ui/format";
import { ALERT_KIND_LABELS, STATUS_GROUP_LABELS } from "../../shared/ui/labels";
import { SeverityBadge } from "../../shared/ui/severity";
import { AlertTriage } from "./alert-triage";

const STATUS_GROUPS: readonly AlertStatus[] = ["open", "ack", "resolved"];

function AlertRow({
  alert,
  projectId,
  now,
}: {
  alert: Alert;
  projectId: string;
  now: string;
}) {
  const etaDays = alert.eta === null ? null : daysUntil(now, alert.eta);

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={alert.severity} />
              <Badge variant="outline">{ALERT_KIND_LABELS[alert.kind]}</Badge>
              <span className="text-xs text-muted-foreground">
                Confianza {formatPercent(alert.confidence)}
              </span>
              <span className="text-xs text-muted-foreground">
                {alert.eta === null
                  ? "Sin ETA"
                  : `ETA ${formatDay(alert.eta)}${
                      etaDays === null ? "" : ` · ${formatDayDistance(etaDays)}`
                    }`}
              </span>
            </div>
            <h3 className="text-sm font-medium">{alert.title}</h3>
          </div>
          <AlertTriage
            alertId={alert.id}
            projectId={projectId}
            transitions={ALERT_STATUS_TRANSITIONS[alert.status]}
          />
        </div>

        {alert.explanation === null ? (
          <p className="text-xs text-muted-foreground italic">
            Explicación de IA pendiente
          </p>
        ) : (
          <div className="space-y-1.5">
            {/* Headline and why are separated by a blank line (see the
                explanation use case), so keep the line breaks. */}
            <p className="text-sm whitespace-pre-line text-muted-foreground">
              {alert.explanation}
            </p>
            {alert.explanationSource === "template" ? (
              <p className="text-[0.7rem] text-muted-foreground/80">
                Generado a partir de los indicadores del detector (sin llamada al
                modelo).
              </p>
            ) : null}
          </div>
        )}

        {alert.suggestedActions.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {alert.suggestedActions.map((action) => (
              <li key={action.title} className="text-muted-foreground">
                <span className="font-medium text-foreground">{action.title}</span> —{" "}
                {action.rationale}
              </li>
            ))}
          </ul>
        ) : null}

        <DriverChips drivers={alert.drivers} />
        <Separator />
        <EvidenceChips evidence={alert.evidence} />
      </CardContent>
    </Card>
  );
}

export function AlertsTab({
  alerts,
  projectId,
  now,
}: {
  alerts: readonly Alert[];
  projectId: string;
  now: string;
}) {
  if (alerts.length === 0) {
    return (
      <EmptyState
        icon={BellIcon}
        title="Este proyecto no tiene alertas"
        description="Los detectores se ejecutan en cada sincronización. Todo lo que encuentren aparecerá aquí con su evidencia."
      />
    );
  }

  return (
    <div className="space-y-6">
      {STATUS_GROUPS.map((status) => {
        const group = alerts.filter((alert) => alert.status === status);
        if (group.length === 0) return null;
        return (
          <section key={status} className="space-y-3">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {STATUS_GROUP_LABELS[status]} · {group.length}
            </h2>
            <div className="space-y-3">
              {group.map((alert) => (
                <AlertRow
                  key={alert.id}
                  alert={alert}
                  projectId={projectId}
                  now={now}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
