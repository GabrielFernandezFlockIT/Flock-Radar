import { z } from "zod";

import { EvidenceListSchema, EvidenceSchema } from "./evidence";
import {
  IsoDateSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  NonNegativeNumberSchema,
  UnitIntervalSchema,
  UuidSchema,
} from "./primitives";

/**
 * Alerts anticipate problems with a date and a confidence. Detectors (pure)
 * produce `DetectorResult`s; triggered results become `Alert`s that the LLM
 * layer may explain, always grounded in the drivers and evidence below.
 */

export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const SeveritySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof SeveritySchema>;

/** A number that explains why an alert fired, e.g. "scope added: 13 pts". */
export const DriverSchema = z.object({
  key: NonEmptyStringSchema,
  label: NonEmptyStringSchema,
  value: z.number().finite(),
  unit: NonEmptyStringSchema.optional(),
  detail: NonEmptyStringSchema.optional(),
});
export type Driver = z.infer<typeof DriverSchema>;

export const SuggestedActionSchema = z.object({
  title: NonEmptyStringSchema,
  rationale: NonEmptyStringSchema,
});
export type SuggestedAction = z.infer<typeof SuggestedActionSchema>;

export const ALERT_KINDS = [
  "sprint_goal_risk",
  "budget_overrun",
  "scope_creep",
  "wip_over_limit",
  "stale_review",
  "stalled_issue",
  "reopen_rate",
] as const;
export const AlertKindSchema = z.enum(ALERT_KINDS);
export type AlertKind = z.infer<typeof AlertKindSchema>;

export const DetectorResultSchema = z.object({
  kind: AlertKindSchema,
  triggered: z.boolean(),
  severity: SeveritySchema,
  /** 0..1 */
  confidence: UnitIntervalSchema,
  /** Day the problem materializes, or `null` when it has no date. */
  eta: IsoDateSchema.nullable(),
  drivers: z.array(DriverSchema),
  evidence: z.array(EvidenceSchema),
});
export type DetectorResult = z.infer<typeof DetectorResultSchema>;

export const ALERT_STATUSES = ["open", "ack", "resolved"] as const;
export const AlertStatusSchema = z.enum(ALERT_STATUSES);
export type AlertStatus = z.infer<typeof AlertStatusSchema>;

export const EXPLANATION_SOURCES = ["llm", "template"] as const;
export const ExplanationSourceSchema = z.enum(EXPLANATION_SOURCES);
export type ExplanationSource = z.infer<typeof ExplanationSourceSchema>;

export const AlertSchema = z.object({
  id: UuidSchema,
  /** Always set: alerts are isolated per project and RLS filters on it. */
  projectId: UuidSchema,
  /**
   * The SUBJECT of the alert, when it has a narrower one than the project:
   * the team and/or the person the problem is about. Both are part of the
   * active-alert key, so the same kind can be active for two people at once
   * (D-054).
   */
  teamId: UuidSchema.nullable(),
  personId: UuidSchema.nullable(),
  kind: AlertKindSchema,
  severity: SeveritySchema,
  confidence: UnitIntervalSchema,
  eta: IsoDateSchema.nullable(),
  title: NonEmptyStringSchema,
  /** Plain-language explanation; `null` until the AI layer (or template) fills it. */
  explanation: z.string().nullable(),
  explanationSource: ExplanationSourceSchema.nullable(),
  drivers: z.array(DriverSchema),
  evidence: EvidenceListSchema,
  suggestedActions: z.array(SuggestedActionSchema),
  status: AlertStatusSchema,
  /** First detection (when this alert row was created). */
  createdAt: IsoDateTimeSchema,
  /** Last change of any field, including status. */
  updatedAt: IsoDateTimeSchema,
  /** Last time a detector reported this problem (every upsert). */
  lastDetectedAt: IsoDateTimeSchema,
});
export type Alert = z.infer<typeof AlertSchema>;

/** The subject an alert is about, beside its project. */
export type AlertSubject = Pick<Alert, "teamId" | "personId">;

/**
 * Identity of the "active alert slot": at most one active alert exists per
 * project, kind, team, and person. Mirrors the generated `active_key` column
 * in `0001_core.sql`, sentinel included, so both repositories agree.
 */
export const ALERT_SUBJECT_SENTINEL = "-";

export function alertSubjectKey(subject: AlertSubject): string {
  return `${subject.teamId ?? ALERT_SUBJECT_SENTINEL}:${subject.personId ?? ALERT_SUBJECT_SENTINEL}`;
}

/**
 * Lifecycle:
 * - `open`: detected, nobody has looked at it yet.
 * - `ack`: seen by someone, still active. Re-detections update it in place
 *   and it keeps blocking a duplicate alert of the same kind.
 * - `resolved`: handled. Terminal for users. If the detector still fires on
 *   the next sync, a NEW `open` alert is created.
 *
 * Users may move open -> ack | resolved and ack -> open | resolved.
 */
export const ALERT_STATUS_TRANSITIONS: Readonly<
  Record<AlertStatus, readonly AlertStatus[]>
> = {
  open: ["ack", "resolved"],
  ack: ["open", "resolved"],
  resolved: [],
};

export function canTransitionAlert(from: AlertStatus, to: AlertStatus): boolean {
  return from === to || ALERT_STATUS_TRANSITIONS[from].includes(to);
}

/** An alert is "active" until it is resolved; acknowledging keeps it active. */
export const ACTIVE_ALERT_STATUSES: readonly AlertStatus[] = ["open", "ack"];

export function isActiveAlert(alert: Pick<Alert, "status">): boolean {
  return ACTIVE_ALERT_STATUSES.includes(alert.status);
}

/**
 * What the AI layer (or the deterministic template) writes for an alert.
 * `headline` is two plain-language sentences, `why` is grounded only in the
 * drivers and evidence the generator was given.
 */
export const ExplanationSchema = z.object({
  headline: NonEmptyStringSchema,
  why: NonEmptyStringSchema,
  suggestedActions: z.array(SuggestedActionSchema).min(1).max(3),
});
export type Explanation = z.infer<typeof ExplanationSchema>;

/** Project facts an explanation may reference. No secrets, no raw records. */
export const ExplanationProjectContextSchema = z.object({
  name: NonEmptyStringSchema,
  clientName: NonEmptyStringSchema,
  startDate: IsoDateSchema,
  endDate: IsoDateSchema,
  budgetAmount: NonNegativeNumberSchema,
  budgetCurrency: NonEmptyStringSchema,
});
export type ExplanationProjectContext = z.infer<
  typeof ExplanationProjectContextSchema
>;

/**
 * Everything an explanation may be built from. It is also the grounding
 * allow-list: a number, date, or identifier that is not derivable from this
 * input is treated as invented (see `checkGrounding`).
 */
export const AlertExplanationInputSchema = z.object({
  kind: AlertKindSchema,
  severity: SeveritySchema,
  confidence: UnitIntervalSchema,
  eta: IsoDateSchema.nullable(),
  title: NonEmptyStringSchema,
  drivers: z.array(DriverSchema),
  evidence: EvidenceListSchema,
  project: ExplanationProjectContextSchema,
});
export type AlertExplanationInput = z.infer<typeof AlertExplanationInputSchema>;
