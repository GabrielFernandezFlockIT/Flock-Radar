import { z } from "zod";

import {
  HttpUrlSchema,
  IsoDateTimeSchema,
  IssueKeySchema,
  NonEmptyStringSchema,
  NonNegativeNumberSchema,
  UuidSchema,
} from "./primitives";

export const STATUS_CATEGORIES = ["todo", "in_progress", "done"] as const;
export const StatusCategorySchema = z.enum(STATUS_CATEGORIES);
export type StatusCategory = z.infer<typeof StatusCategorySchema>;

export const IssueSchema = z.object({
  projectId: UuidSchema,
  /** Natural key, unique per project: `BCN-123`. */
  key: IssueKeySchema,
  title: NonEmptyStringSchema,
  /** Tracker issue type name: `Story`, `Bug`, `Task`, `Spike`, ... */
  type: NonEmptyStringSchema,
  /** Workflow status name: `To Do`, `In Progress`, `In Review`, `Done`, ... */
  status: NonEmptyStringSchema,
  statusCategory: StatusCategorySchema,
  points: NonNegativeNumberSchema.nullable(),
  assignee: NonEmptyStringSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  resolvedAt: IsoDateTimeSchema.nullable(),
  url: HttpUrlSchema,
  /** `Sprint.id` of the sprint the issue currently belongs to. */
  sprintId: UuidSchema.nullable(),
  /** Whether finishing this issue is expected to ship code (see `issueRequiresCode`). */
  requiresCode: z.boolean(),
});
export type Issue = z.infer<typeof IssueSchema>;

/**
 * Issue types whose completion is expected to land through a merged PR.
 * Compared case-insensitively after trimming.
 */
export const CODE_ISSUE_TYPES: readonly string[] = [
  "story",
  "bug",
  "task",
  "sub-task",
  "subtask",
  "improvement",
  "new feature",
  "feature",
];

/** Labels that mark an otherwise-code issue type as non-code work. */
export const NON_CODE_LABELS: readonly string[] = [
  "docs",
  "documentation",
  "no-code",
];

/**
 * Rule: an issue requires code when its type is Story, Bug, Task, Sub-task,
 * Improvement, New Feature, or Feature, unless it carries a non-code label (`docs`,
 * `documentation`, `no-code`), e.g. a docs-only sub-task. Spikes, Epics, and
 * unknown types do not require code: when in doubt we avoid flagging a
 * "Done without merged PR" pending item that may be noise.
 */
export function issueRequiresCode(
  type: string,
  labels: readonly string[] = [],
): boolean {
  const normalizedLabels = labels.map((label) => label.trim().toLowerCase());
  if (normalizedLabels.some((label) => NON_CODE_LABELS.includes(label))) {
    return false;
  }
  return CODE_ISSUE_TYPES.includes(type.trim().toLowerCase());
}

export const ISSUE_EVENT_FIELDS = [
  "status",
  "sprint",
  "points",
  "resolution",
] as const;
export const IssueEventFieldSchema = z.enum(ISSUE_EVENT_FIELDS);
export type IssueEventField = z.infer<typeof IssueEventFieldSchema>;

/**
 * One field change from the tracker changelog. Values are strings:
 * - `status`: status names (`In Progress`)
 * - `sprint`: `Sprint.id` values (`null` = backlog)
 * - `points`: decimal numbers as strings (`"5"`)
 * - `resolution`: resolution names (`Done`), `null` when cleared (reopened)
 */
export const IssueEventSchema = z.object({
  projectId: UuidSchema,
  /** Stable id from the source (Jira changelog history id + item index). */
  externalId: NonEmptyStringSchema,
  issueKey: IssueKeySchema,
  field: IssueEventFieldSchema,
  from: z.string().nullable(),
  to: z.string().nullable(),
  at: IsoDateTimeSchema,
  author: NonEmptyStringSchema.nullable(),
});
export type IssueEvent = z.infer<typeof IssueEventSchema>;

export const IssueCommentSchema = z.object({
  projectId: UuidSchema,
  issueKey: IssueKeySchema,
  /** Comment id in the source tracker. */
  id: NonEmptyStringSchema,
  author: NonEmptyStringSchema,
  body: z.string(),
  createdAt: IsoDateTimeSchema,
  url: HttpUrlSchema,
});
export type IssueComment = z.infer<typeof IssueCommentSchema>;

export const WorklogSchema = z.object({
  projectId: UuidSchema,
  issueKey: IssueKeySchema,
  /** Worklog id in the source tracker. */
  id: NonEmptyStringSchema,
  author: NonEmptyStringSchema,
  seconds: z.number().int().positive(),
  startedAt: IsoDateTimeSchema,
});
export type Worklog = z.infer<typeof WorklogSchema>;
