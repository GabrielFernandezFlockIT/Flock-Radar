import { z } from "zod";

import {
  CurrencyCodeSchema,
  GithubRepoSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  NonNegativeNumberSchema,
  ProjectKeySchema,
  UuidSchema,
} from "./primitives";

/**
 * Zod 4 note: `.omit()`, `.pick()`, and `.partial()` throw on object schemas
 * that carry refinements. Each refined entity therefore exports its plain
 * `*FieldsSchema` (derive from this one) and the refined `*Schema` (validate
 * with this one).
 */

/** Throughput unit used by the forecast engine (see decision D-007). */
export const FORECAST_UNITS = ["points", "issues"] as const;
export const ForecastUnitSchema = z.enum(FORECAST_UNITS);
export type ForecastUnit = z.infer<typeof ForecastUnitSchema>;

export const ProjectFieldsSchema = z.object({
  id: UuidSchema,
  name: NonEmptyStringSchema,
  jiraKey: ProjectKeySchema,
  /** `owner/name` */
  githubRepo: GithubRepoSchema,
  clientName: NonEmptyStringSchema,
  budgetAmount: NonNegativeNumberSchema,
  budgetCurrency: CurrencyCodeSchema,
  hourlyRate: NonNegativeNumberSchema,
  startDate: IsoDateSchema,
  endDate: IsoDateSchema,
  forecastUnit: ForecastUnitSchema,
  /** Maximum issues "in progress" in the active sprint before alerting. */
  wipLimit: z.number().int().positive(),
  /** Jira Agile board id, when the project uses one. */
  boardId: NonEmptyStringSchema.optional(),
});

export const ProjectSchema = ProjectFieldsSchema.refine(
  (project) => project.startDate <= project.endDate,
  {
    message: "Project.startDate must be on or before Project.endDate",
    path: ["endDate"],
  },
);
export type Project = z.infer<typeof ProjectSchema>;

export const SPRINT_STATES = ["future", "active", "closed"] as const;
export const SprintStateSchema = z.enum(SPRINT_STATES);
export type SprintState = z.infer<typeof SprintStateSchema>;

/**
 * A sprint. `startAt`/`endAt` are instants (not days) so that "added after
 * sprint start" is exact even when items are added on the first day.
 * Natural key: `(projectId, externalId)`; `id` is assigned once and never
 * overwritten by a sync.
 */
export const SprintFieldsSchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  /** Id in the source tracker (Jira sprint id). */
  externalId: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  goal: z.string().nullable(),
  startAt: IsoDateTimeSchema,
  endAt: IsoDateTimeSchema,
  state: SprintStateSchema,
  /** Points committed when the sprint started (before any scope change). */
  committedPoints: NonNegativeNumberSchema.nullable(),
});

export const SprintSchema = SprintFieldsSchema.refine(
  (sprint) => Date.parse(sprint.startAt) < Date.parse(sprint.endAt),
  {
    message: "Sprint.startAt must be before Sprint.endAt",
    path: ["endAt"],
  },
);
export type Sprint = z.infer<typeof SprintSchema>;
