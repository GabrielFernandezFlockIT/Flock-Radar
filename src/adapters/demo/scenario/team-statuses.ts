import { stableUuid } from "@/adapters/shared/stable-ids";
import {
  HOUR_MS,
  addDays,
  addWorkingDays,
  isWorkingDay,
  startOfUtcDay,
  toIsoDate,
  type Person,
  type Status,
  type Team,
  type TeamMember,
} from "@/shared/domain";

import type { ProjectSpec } from "./spec";
import { statusScriptsOf, type PersonStatusScript } from "./status-scripts";

/**
 * Teams, people, memberships, and daily statuses for one demo project.
 *
 * Determinism, like the rest of the scenario: the only inputs are the spec
 * and the UTC day of `now`, every id is a name-based UUID, and no clock or
 * `Math.random` is read. The Spanish status copy lives in `status-scripts.ts`.
 *
 * `people` ids are derived from the GitHub login alone, not from the project,
 * because people are organization-level (D-050): the same person appearing in
 * two projects would be one row.
 */

/** Two weeks of entries: the last 10 working days, today included. */
export const STATUS_WORKING_DAYS = 10;

/** Working day a membership starts, counted back from today. */
const MEMBERSHIP_WORKING_DAYS_AGO = 120;
/** Statuses are written at the end of the working day (UTC). */
const STATUS_HOUR = 17.5;

export interface TeamRecords {
  team: Team;
  people: Person[];
  teamMembers: TeamMember[];
  statuses: Status[];
}

function personId(login: string): string {
  return stableUuid("demo", "person", login);
}

/** `login@demo-org.test`: fictional, and a reserved TLD that cannot resolve. */
function personEmail(login: string): string {
  return `${login}@demo-org.test`;
}

/** The last `count` working days ending on the last working day <= `today`. */
function recentWorkingDays(today: Date, count: number): Date[] {
  let cursor = startOfUtcDay(today);
  while (!isWorkingDay(cursor)) cursor = addDays(cursor, -1);
  const days: Date[] = [cursor];
  while (days.length < count) {
    cursor = addWorkingDays(cursor, -1);
    days.unshift(cursor);
  }
  return days;
}

/** Entry applies on the last `days` days of a window of length `total`. */
function appliesOnDay(index: number, total: number, days: number): boolean {
  return index >= total - days;
}

function rotate(values: readonly string[], index: number): string {
  return values[index % values.length];
}

export function buildTeamRecords(spec: ProjectSpec, now: Date): TeamRecords {
  const today = startOfUtcDay(now);
  const projectId = stableUuid("demo", "project", spec.slug);
  const teamId = stableUuid("demo", "team", spec.slug);
  const createdAt = addWorkingDays(today, -MEMBERSHIP_WORKING_DAYS_AGO);
  const createdAtIso = createdAt.toISOString();

  const team: Team = {
    id: teamId,
    projectId,
    name: spec.team.name,
    description: spec.team.description,
    active: true,
    createdAt: createdAtIso,
    updatedAt: createdAtIso,
  };

  const people: Person[] = spec.people.map((person) => ({
    id: personId(person.login),
    fullName: person.name,
    email: personEmail(person.login),
    active: true,
    createdAt: createdAtIso,
    updatedAt: createdAtIso,
  }));

  // Late joiners (Cobalt's ramp-up) start when the burn window opens, so the
  // membership agrees with the worklogs the builder already generates.
  const lateStart =
    spec.burn.kind === "accelerating"
      ? addWorkingDays(today, -spec.burn.windowWorkingDays)
      : createdAt;

  const teamMembers: TeamMember[] = spec.people.map((person, index) => ({
    id: stableUuid("demo", "team-member", spec.slug, person.login),
    teamId,
    personId: personId(person.login),
    role: spec.team.roles[index],
    startedOn: toIsoDate(person.joinsLate ? lateStart : createdAt),
    endedOn: null,
  }));

  const leadIndex = spec.team.roles.indexOf("lead");
  const leadPersonId = personId(spec.people[leadIndex].login);
  const days = recentWorkingDays(today, STATUS_WORKING_DAYS);
  const scripts = statusScriptsOf(spec.slug);

  const statuses: Status[] = [];
  for (const script of scripts) {
    const person = spec.people[script.person];
    for (const [index, day] of days.entries()) {
      // A late joiner has nothing to report before joining.
      if (person.joinsLate && day < lateStart) continue;
      statuses.push(
        buildStatus({
          script,
          index,
          total: days.length,
          day,
          projectId,
          teamId,
          personId: personId(person.login),
          // The lead loads the last status of one teammate on their behalf.
          authorPersonId:
            spec.team.statusLoadedByLeadFor === script.person &&
            index === days.length - 1
              ? leadPersonId
              : personId(person.login),
          login: person.login,
        }),
      );
    }
  }

  return { team, people, teamMembers, statuses };
}

function buildStatus(input: {
  script: PersonStatusScript;
  index: number;
  total: number;
  day: Date;
  projectId: string;
  teamId: string;
  personId: string;
  authorPersonId: string;
  login: string;
}): Status {
  const { script, index, total, day } = input;
  const reportedOn = toIsoDate(day);
  const note =
    script.note && appliesOnDay(index, total, script.note.days)
      ? ` ${script.note.text}`
      : "";
  const blockers =
    script.blocker && appliesOnDay(index, total, script.blocker.days)
      ? script.blocker.text
      : null;
  const nextSteps = rotate(script.nextSteps, index);
  const writtenAt = new Date(day.getTime() + STATUS_HOUR * HOUR_MS).toISOString();

  return {
    id: stableUuid("demo", "status", input.login, reportedOn),
    projectId: input.projectId,
    teamId: input.teamId,
    personId: input.personId,
    reportedOn,
    summary: `${rotate(script.summaries, index)}${note}`,
    blockers,
    nextSteps: nextSteps === "" ? null : nextSteps,
    authorPersonId: input.authorPersonId,
    source: "manual",
    createdAt: writtenAt,
    updatedAt: writtenAt,
  };
}
