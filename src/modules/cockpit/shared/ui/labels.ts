import type {
  AlertKind,
  AlertStatus,
  Evidence,
  ForecastUnit,
  MemoryItemKind,
  Severity,
  SyncRunStatus,
  TeamRole,
} from "@/shared/domain";

/**
 * Display labels for the domain enums.
 *
 * The domain keeps its English values — they are persisted data contracts
 * (`open`, `critical`, `sprint_goal_risk`, ...). Only the presentation layer
 * speaks Spanish, so a label change can never move a stored value.
 */

export const SEVERITY_LABELS: Readonly<Record<Severity, string>> = {
  critical: "Crítica",
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

export const STATUS_LABELS: Readonly<Record<AlertStatus, string>> = {
  open: "Abierta",
  ack: "Reconocida",
  resolved: "Resuelta",
};

/** Plural form, used as the heading of a status group. */
export const STATUS_GROUP_LABELS: Readonly<Record<AlertStatus, string>> = {
  open: "Abiertas",
  ack: "Reconocidas",
  resolved: "Resueltas",
};

/** The button that moves an alert INTO each status. */
export const STATUS_ACTION_LABELS: Readonly<Record<AlertStatus, string>> = {
  open: "Reabrir",
  ack: "Reconocer",
  resolved: "Resolver",
};

export const ALERT_KIND_LABELS: Readonly<Record<AlertKind, string>> = {
  sprint_goal_risk: "Riesgo del objetivo del sprint",
  budget_overrun: "Desvío de presupuesto",
  scope_creep: "Crecimiento del alcance",
  wip_over_limit: "WIP sobre el límite",
  stale_review: "Revisiones demoradas",
  stalled_issue: "Trabajo detenido",
  reopen_rate: "Tasa de reapertura",
};

/** Plural: every memory kind is shown as the heading of its own section. */
export const MEMORY_KIND_LABELS: Readonly<Record<MemoryItemKind, string>> = {
  done: "Resueltos",
  pending: "Pendientes",
  decision: "Decisiones",
  risk: "Riesgos",
  next_step: "Próximos pasos",
};

export const SOURCE_TYPE_LABELS: Readonly<Record<Evidence["sourceType"], string>> = {
  jira_issue: "Incidencia de Jira",
  jira_transition: "Transición de Jira",
  jira_comment: "Comentario de Jira",
  jira_worklog: "Parte de horas",
  jira_sprint: "Sprint",
  github_pr: "Pull request",
  github_review: "Revisión",
  github_commit: "Commit",
  calendar_event: "Evento de calendario",
  doc: "Documento",
  status: "Estado diario",
};

/** Short form, used where the chip row is already dense. */
export const SOURCE_TYPE_SHORT_LABELS: Readonly<
  Record<Evidence["sourceType"], string>
> = {
  jira_issue: "Incidencia",
  jira_transition: "Transición",
  jira_comment: "Comentario",
  jira_worklog: "Parte de horas",
  jira_sprint: "Sprint",
  github_pr: "PR",
  github_review: "Revisión",
  github_commit: "Commit",
  calendar_event: "Evento",
  doc: "Documento",
  status: "Estado",
};

export const SYNC_SOURCE_LABELS: Readonly<Record<string, string>> = {
  jira: "Jira",
  github: "GitHub",
  calendar: "Calendario",
  docs: "Documentos",
};

export const SYNC_STATUS_LABELS: Readonly<Record<SyncRunStatus, string>> = {
  ok: "correcta",
  running: "en curso",
  partial: "parcial",
  failed: "fallida",
};

/** The unit a forecast counts in, as it is written next to a number. */
export const FORECAST_UNIT_LABELS: Readonly<Record<ForecastUnit, string>> = {
  points: "pts",
  issues: "incidencias",
};

/**
 * Role inside a team. The stored values are stable English identifiers
 * (`TEAM_ROLES`); only these labels are Spanish, so renaming one can never
 * move a persisted value.
 */
export const TEAM_ROLE_LABELS: Readonly<Record<TeamRole, string>> = {
  developer: "Desarrollador",
  lead: "Líder",
  business_translator: "Business Translator",
  functional_analyst: "Analista Funcional",
  ux_ui_designer: "Diseñador UX/UI",
};
