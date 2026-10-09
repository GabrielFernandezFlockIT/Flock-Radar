import { describe, expect, it } from "vitest";

import {
  PersonSchema,
  StatusSchema,
  TeamMemberSchema,
  TeamSchema,
  isWorkingDay,
  fromIsoDate,
} from "@/shared/domain";

import { buildDemoDataset, type DemoDataset } from "./dataset";
import { DEMO_SCENARIO_EXPECTATIONS as EXPECT } from "./expectations";
import { DEMO_PROJECT_SPECS } from "./projects";
import { STATUS_SIGNAL_MARKERS } from "./status-scripts";
import { STATUS_WORKING_DAYS } from "./team-statuses";

const NOW = new Date("2026-10-08T15:30:00Z"); // a Thursday

/** One anchor per weekday, so the story holds whatever day the demo runs. */
const WEEK = Array.from(
  { length: 7 },
  (_, index) => new Date(Date.UTC(2026, 9, 5 + index, 23, 59)),
);

function teamOf(dataset: DemoDataset, name: string) {
  const team = dataset.teams.find((item) => item.name === name);
  if (!team) throw new Error(`missing team ${name}`);
  const members = dataset.teamMembers.filter((item) => item.teamId === team.id);
  const nameOf = (personId: string) => {
    const person = dataset.people.find((item) => item.id === personId);
    if (!person) throw new Error(`missing person ${personId}`);
    return person.fullName;
  };
  const statuses = dataset.statuses.filter((item) => item.teamId === team.id);
  return { team, members, statuses, nameOf };
}

/** Consecutive working days ending on the LAST reported day with a blocker. */
function trailingBlockerDays(
  statuses: Array<{ reportedOn: string; blockers: string | null }>,
): number {
  const ordered = [...statuses].sort((a, b) => (a.reportedOn < b.reportedOn ? -1 : 1));
  let count = 0;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    if (ordered[index].blockers === null) break;
    count += 1;
  }
  return count;
}

describe("teams, people, and statuses", () => {
  const dataset = buildDemoDataset(NOW);

  it("builds one team per project and validates every record", () => {
    expect(dataset.teams).toHaveLength(DEMO_PROJECT_SPECS.length);
    expect(dataset.teams.map((team) => team.name)).toEqual([
      EXPECT.atlas.team.name,
      EXPECT.beacon.team.name,
      EXPECT.cobalt.team.name,
    ]);
    for (const team of dataset.teams) expect(() => TeamSchema.parse(team)).not.toThrow();
    for (const person of dataset.people) {
      expect(() => PersonSchema.parse(person)).not.toThrow();
    }
    for (const member of dataset.teamMembers) {
      expect(() => TeamMemberSchema.parse(member)).not.toThrow();
    }
    for (const status of dataset.statuses) {
      expect(() => StatusSchema.parse(status)).not.toThrow();
    }
  });

  it("keeps people organization-level and unique, with exactly one lead per team", () => {
    const ids = dataset.people.map((person) => person.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(dataset.people).toHaveLength(
      DEMO_PROJECT_SPECS.length * EXPECT.statuses.peoplePerTeam,
    );

    for (const team of dataset.teams) {
      const members = dataset.teamMembers.filter((item) => item.teamId === team.id);
      expect(members).toHaveLength(EXPECT.statuses.peoplePerTeam);
      expect(members.filter((item) => item.role === "lead")).toHaveLength(
        EXPECT.statuses.leadsPerTeam,
      );
    }
  });

  it("reports only on working days, one entry per person and day", () => {
    const seen = new Set<string>();
    for (const status of dataset.statuses) {
      expect(isWorkingDay(fromIsoDate(status.reportedOn))).toBe(true);
      const key = `${status.personId}:${status.reportedOn}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      expect(status.source).toBe(EXPECT.statuses.source);
    }
    // Two weeks per person, except Cobalt's late joiners, who have less.
    const { statuses } = teamOf(dataset, EXPECT.beacon.team.name);
    expect(statuses).toHaveLength(
      EXPECT.statuses.peoplePerTeam * STATUS_WORKING_DAYS,
    );
    expect(STATUS_WORKING_DAYS).toBe(EXPECT.statuses.workingDaysPerPerson);
  });

  it.each(WEEK.map((day) => [day.toISOString().slice(0, 10), day] as const))(
    "encodes the scenario's signals in the Spanish copy (anchor %s)",
    (_label, anchor) => {
      const built = buildDemoDataset(anchor);

      // Atlas is healthy: nobody reports a blocker, ever.
      const atlas = teamOf(built, EXPECT.atlas.team.name);
      expect(atlas.statuses.every((status) => status.blockers === null)).toBe(true);

      // Beacon: repeated blockers, the mid-sprint scope, and the PTO.
      const beacon = teamOf(built, EXPECT.beacon.team.name);
      for (const [person, days] of Object.entries(
        EXPECT.beacon.team.consecutiveBlockerDays,
      )) {
        const own = beacon.statuses.filter(
          (status) => beacon.nameOf(status.personId) === person,
        );
        expect(trailingBlockerDays(own), person).toBe(days);
        const issueKey =
          EXPECT.beacon.team.blockedIssueKeys[
            person as keyof typeof EXPECT.beacon.team.blockedIssueKeys
          ];
        expect(
          own.at(-1)?.blockers?.includes(issueKey),
          `${person} names ${issueKey}`,
        ).toBe(true);
      }
      const mentions = (people: readonly string[], marker: string) => {
        for (const person of people) {
          const latest = beacon.statuses
            .filter((status) => beacon.nameOf(status.personId) === person)
            .at(-1);
          expect(latest?.summary.includes(marker), `${person}: ${marker}`).toBe(true);
        }
      };
      mentions(EXPECT.beacon.team.ptoMentionedBy, STATUS_SIGNAL_MARKERS.pto);
      mentions(EXPECT.beacon.team.scopeMentionedBy, STATUS_SIGNAL_MARKERS.scope);

      // Cobalt: everyone reports effort, matching the accelerating burn.
      const cobalt = teamOf(built, EXPECT.cobalt.team.name);
      for (const person of EXPECT.cobalt.team.overtimeMentionedBy) {
        const own = cobalt.statuses
          .filter((status) => cobalt.nameOf(status.personId) === person)
          .filter((status) => status.summary.includes(STATUS_SIGNAL_MARKERS.overtime));
        expect(own.length, person).toBe(EXPECT.cobalt.team.consecutiveOvertimeDays);
      }
      expect(cobalt.statuses.every((status) => status.blockers === null)).toBe(true);
    },
  );

  it("lets the lead load the most recent status of a teammate on her behalf", () => {
    const beacon = teamOf(dataset, EXPECT.beacon.team.name);
    const onBehalf = beacon.statuses.filter(
      (status) => status.authorPersonId !== status.personId,
    );
    expect(onBehalf).toHaveLength(1);
    expect(beacon.nameOf(onBehalf[0].personId)).toBe(
      EXPECT.beacon.team.reportedOnBehalfOf,
    );
    expect(beacon.nameOf(onBehalf[0].authorPersonId)).toBe(EXPECT.beacon.team.lead);
  });

  it("is deterministic for the same UTC day", () => {
    const again = buildDemoDataset(new Date("2026-10-08T06:15:00Z"));
    expect(again.statuses).toEqual(dataset.statuses);
    expect(again.teamMembers).toEqual(dataset.teamMembers);
  });
});
