import { z } from "zod";

import {
  IsoDateSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  UuidSchema,
} from "./primitives";

/**
 * A daily status entry: what one person reports about one day of work.
 *
 * It is a FIRST-CLASS, USER-AUTHORED entity, not a `memory_item` (D-053).
 * Memory items are derived and regenerated on every run; a status is the
 * source of truth that later passes (memory, detectors, the LLM analysis)
 * read FROM. Nothing regenerates it.
 *
 * `projectId` is deliberately denormalized (the project is reachable through
 * the team) so RLS filters a status row without a join, exactly like the
 * other project-scoped child tables. A composite foreign key to
 * `teams (project_id, id)` keeps the two columns consistent (D-027, D-052).
 */

/** Where the entry came from. `manual` is the only ingestion path today. */
export const STATUS_SOURCES = ["manual"] as const;
export const StatusSourceSchema = z.enum(STATUS_SOURCES);
export type StatusSource = z.infer<typeof StatusSourceSchema>;

/**
 * Natural key: `(personId, reportedOn)` — one status per person per day.
 * Re-reporting the same day REPLACES the entry; `id` is never overwritten.
 *
 * `personId` is whom the status is ABOUT; `authorPersonId` is who entered it,
 * which may differ (a lead loading a status on someone's behalf).
 */
export const StatusSchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  teamId: UuidSchema,
  personId: UuidSchema,
  reportedOn: IsoDateSchema,
  /** "Avances": what moved forward. Always present. */
  summary: NonEmptyStringSchema,
  /** "Bloqueos": what is blocking, or `null` when nothing is. */
  blockers: NonEmptyStringSchema.nullable(),
  /** "Próximos pasos": what comes next, or `null`. */
  nextSteps: NonEmptyStringSchema.nullable(),
  authorPersonId: UuidSchema,
  source: StatusSourceSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Status = z.infer<typeof StatusSchema>;

/** A status reported by someone other than the person it is about. */
export function isReportedOnBehalf(status: Status): boolean {
  return status.authorPersonId !== status.personId;
}

/** True when the entry records something blocking that day. */
export function hasBlockers(status: Pick<Status, "blockers">): boolean {
  return status.blockers !== null;
}
