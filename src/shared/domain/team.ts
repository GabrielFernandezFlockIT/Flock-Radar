import { z } from "zod";

import {
  IsoDateSchema,
  IsoDateTimeSchema,
  NonEmptyStringSchema,
  UuidSchema,
} from "./primitives";

/**
 * Teams, people, and membership.
 *
 * Shape (decisions D-050 and D-051):
 * - A `Team` hangs off a project: projects stay the root of the portfolio.
 * - A `Person` is ORGANIZATION-level, not project-level, so the same person
 *   can belong to teams in different projects without being duplicated.
 * - The ROLE lives on the membership, never on the person: the same person
 *   can be the lead of one team and a developer in another.
 */

/**
 * Stable English role identifiers. These are PERSISTED data (a check
 * constraint in `0001_core.sql` lists the same values), so they never change
 * with the UI language; Spanish display labels live in the presentation layer
 * (`src/modules/cockpit/shared/ui/labels.ts`).
 */
export const TEAM_ROLES = [
  "developer",
  "lead",
  "business_translator",
  "functional_analyst",
  "ux_ui_designer",
] as const;
export const TeamRoleSchema = z.enum(TEAM_ROLES);
export type TeamRole = z.infer<typeof TeamRoleSchema>;

/**
 * A team inside a project. Natural key: `(projectId, name)`; `id` is assigned
 * once and never overwritten. `active` is a soft delete: a disbanded team
 * keeps its statuses and its history.
 */
export const TeamSchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  name: NonEmptyStringSchema,
  description: z.string().nullable(),
  active: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Team = z.infer<typeof TeamSchema>;

/**
 * A person in the organization. `email` is optional data (nullable) but
 * unique when present, so a directory import can key on it later.
 */
export const PersonSchema = z.object({
  id: UuidSchema,
  fullName: NonEmptyStringSchema,
  email: z.email().nullable(),
  active: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Person = z.infer<typeof PersonSchema>;

/**
 * One person's membership of one team, with the role they hold THERE.
 * Natural key: `(teamId, personId, startedOn)`, so a person who leaves and
 * rejoins keeps both periods instead of overwriting the first.
 *
 * Zod 4 note (D-035): derive with `.omit`/`.pick`/`.partial` from the plain
 * `TeamMemberFieldsSchema`; validate with the refined `TeamMemberSchema`.
 */
export const TeamMemberFieldsSchema = z.object({
  id: UuidSchema,
  teamId: UuidSchema,
  personId: UuidSchema,
  role: TeamRoleSchema,
  startedOn: IsoDateSchema,
  /** `null` while the membership is current. */
  endedOn: IsoDateSchema.nullable(),
});

export const TeamMemberSchema = TeamMemberFieldsSchema.refine(
  (member) => member.endedOn === null || member.startedOn <= member.endedOn,
  {
    message: "TeamMember.startedOn must be on or before TeamMember.endedOn",
    path: ["endedOn"],
  },
);
export type TeamMember = z.infer<typeof TeamMemberSchema>;

/** A membership is current on `day` when it started and has not ended. */
export function isActiveMembership(member: TeamMember, day: string): boolean {
  return member.startedOn <= day && (member.endedOn === null || day <= member.endedOn);
}
