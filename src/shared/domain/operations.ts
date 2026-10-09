import { z } from "zod";

import {
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  NonNegativeIntSchema,
  NonNegativeNumberSchema,
  UuidSchema,
} from "./primitives";

/** Logical data sources, one `SyncRun` each per sync. */
export const SYNC_SOURCES = ["jira", "github", "calendar", "docs"] as const;
export const SyncSourceSchema = z.enum(SYNC_SOURCES);
export type SyncSource = z.infer<typeof SyncSourceSchema>;

export const SYNC_RUN_STATUSES = ["running", "ok", "partial", "failed"] as const;
export const SyncRunStatusSchema = z.enum(SYNC_RUN_STATUSES);
export type SyncRunStatus = z.infer<typeof SyncRunStatusSchema>;

export const SyncRunStatsSchema = z.record(z.string(), NonNegativeNumberSchema);
export type SyncRunStats = z.infer<typeof SyncRunStatsSchema>;

/**
 * One sync attempt of one source for one project; drives freshness badges.
 * `error` is a short sanitized reason (e.g. `jira: HTTP 401 unauthorized`),
 * never a raw upstream body or URL.
 */
export const SyncRunSchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  source: SyncSourceSchema,
  startedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema.nullable(),
  status: SyncRunStatusSchema,
  /** Record counts, e.g. `{ issues: 72, issueEvents: 310 }`. */
  stats: SyncRunStatsSchema,
  error: z.string().max(500).nullable(),
});
export type SyncRun = z.infer<typeof SyncRunSchema>;

/** Usage and cost of one LLM call, for the admin page. */
export const LlmCallSchema = z.object({
  id: UuidSchema,
  /** What the call was for: `alert_explanation`, `memory_extraction`, `chat`, ... */
  purpose: NonEmptyStringSchema,
  model: NonEmptyStringSchema,
  inputTokens: NonNegativeIntSchema,
  outputTokens: NonNegativeIntSchema,
  cacheReadTokens: NonNegativeIntSchema,
  latencyMs: NonNegativeIntSchema,
  stopReason: z.string().nullable(),
  costUsd: NonNegativeNumberSchema,
  createdAt: IsoDateTimeSchema,
});
export type LlmCall = z.infer<typeof LlmCallSchema>;

export interface LlmUsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}
