import type { DetectorResult, Evidence, Issue, Severity } from "@/shared/domain";

import { formatShortDate, round } from "./dates";
import { issueChangeEvidence, sprintEvidence } from "./evidence";
import {
  DEFAULT_FORECAST_OPTIONS,
  insufficientDataDriver,
  type ForecastOptions,
  type ProjectSnapshot,
} from "./snapshot";
import { unitLabel } from "./sprint-completion";
import type { SprintScope } from "./sprint-scope";

/**
 * Scope creep (decision D-040): work added to the active sprint after it
 * started (issues pulled in, estimates raised) net of work removed (issues
 * moved out, estimates lowered), relative to the scope committed at start.
 */

/** Severity by net growth: > 50% critical, > 30% high, else medium. */
export function scopeCreepSeverity(ratio: number): Severity {
  if (ratio > 0.5) return "critical";
  if (ratio > 0.3) return "high";
  if (ratio > 0.15) return "medium";
  return "low";
}

export interface ScopeCreepSummary {
  committed: number;
  added: number;
  removed: number;
  net: number;
  ratio: number | null;
}

export function summarizeScopeCreep(scope: SprintScope): ScopeCreepSummary {
  const added = scope.changes
    .filter((change) => change.delta > 0)
    .reduce((sum, change) => sum + change.delta, 0);
  const removed = scope.changes
    .filter((change) => change.delta < 0)
    .reduce((sum, change) => sum - change.delta, 0);
  const net = added - removed;
  return {
    committed: scope.committed,
    added,
    removed,
    net,
    ratio: scope.committed > 0 ? net / scope.committed : null,
  };
}

export function detectScopeCreep(
  snapshot: ProjectSnapshot,
  scope: SprintScope | null,
  options: ForecastOptions = DEFAULT_FORECAST_OPTIONS,
): DetectorResult {
  if (!scope) {
    return {
      kind: "scope_creep",
      triggered: false,
      severity: "low",
      confidence: 0.1,
      eta: null,
      drivers: [insufficientDataDriver("No hay un sprint activo.")],
      evidence: [],
    };
  }
  const summary = summarizeScopeCreep(scope);
  const eta = scope.days.at(-1) ?? null;
  if (summary.ratio === null) {
    return {
      kind: "scope_creep",
      triggered: false,
      severity: "low",
      confidence: 0.1,
      eta,
      drivers: [insufficientDataDriver("No se comprometió nada al inicio del sprint.")],
      evidence: [],
    };
  }

  const label = unitLabel(scope.unit);
  const triggered = summary.ratio > options.scopeCreepThreshold;
  const issuesByKey = new Map<string, Issue>(
    snapshot.issues.map((issue) => [issue.key, issue]),
  );
  const evidence: Evidence[] = [];
  const sprintRef = sprintEvidence(scope.sprint, snapshot.project, scope.members);
  if (sprintRef) evidence.push(sprintRef);
  for (const change of scope.changes) {
    const issue = issuesByKey.get(change.issueKey);
    if (!issue) continue;
    const day = formatShortDate(change.at.slice(0, 10));
    const text =
      change.kind === "reestimated"
        ? `Reestimada de ${change.from ?? 0} a ${change.to ?? 0} ${label} el ${day}`
        : change.kind === "added"
          ? `Agregada al sprint el ${day} (+${round(change.delta)} ${label})`
          : `Quitada del sprint el ${day} (${round(change.delta)} ${label})`;
    evidence.push(issueChangeEvidence(issue, change.event, text));
  }

  const count = (kind: string) => scope.changes.filter((change) => change.kind === kind).length;
  return {
    kind: "scope_creep",
    triggered,
    severity: scopeCreepSeverity(summary.ratio),
    // Direct observation from the changelog; less sure when counting issues.
    confidence: scope.unit === snapshot.project.forecastUnit ? 0.9 : 0.7,
    eta,
    drivers: [
      { key: "committed_scope", label: "Comprometido al inicio del sprint", value: round(summary.committed), unit: label },
      { key: "scope_added", label: "Agregado después del inicio del sprint", value: round(summary.added), unit: label },
      { key: "scope_removed", label: "Quitado después del inicio del sprint", value: round(summary.removed), unit: label },
      { key: "scope_growth", label: "Crecimiento neto del alcance frente a lo comprometido", value: Math.round(summary.ratio * 100), unit: "%" },
      { key: "issues_added", label: "Incidencias incorporadas al sprint", value: count("added"), unit: "incidencias" },
      { key: "reestimates", label: "Cambios de estimación después del inicio del sprint", value: count("reestimated"), unit: "incidencias" },
    ],
    evidence,
  };
}

export function scopeCreepTitle(scope: SprintScope): string {
  const summary = summarizeScopeCreep(scope);
  const label = unitLabel(scope.unit);
  const percent = Math.round((summary.ratio ?? 0) * 100);
  return `El alcance creció ${percent}% desde el inicio del sprint (+${round(summary.net)} ${label} sobre ${round(summary.committed)} comprometidas)`;
}
