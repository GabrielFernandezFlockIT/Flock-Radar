import {
  startOfUtcDay,
  toIsoDate,
  type CalendarEvent,
  type Commit,
  type DocRef,
  type Issue,
  type IssueComment,
  type IssueEvent,
  type Person,
  type Project,
  type PullRequest,
  type Sprint,
  type Status,
  type Team,
  type TeamMember,
  type Worklog,
} from "@/shared/domain";

import { buildProjectRecords } from "./builder";
import { DEMO_PROJECT_SPECS } from "./projects";
import { buildTeamRecords } from "./team-statuses";

/** Every record of the demo scenario, as the demo source adapters serve it. */
export interface DemoDataset {
  /** UTC day the scenario is anchored to (`YYYY-MM-DD`). */
  anchorDate: string;
  projects: Project[];
  sprints: Sprint[];
  issues: Issue[];
  issueEvents: IssueEvent[];
  issueComments: IssueComment[];
  worklogs: Worklog[];
  pullRequests: PullRequest[];
  commits: Commit[];
  calendarEvents: CalendarEvent[];
  docs: DocRef[];
  /** One team per project; people are ORGANIZATION-level (D-050). */
  teams: Team[];
  people: Person[];
  teamMembers: TeamMember[];
  /** Two weeks of daily entries per person, in Spanish (user-authored copy). */
  statuses: Status[];
}

/**
 * Builds the demo scenario anchored to the UTC day of `now`.
 *
 * Pure and deterministic: the same UTC day always yields deep-equal data
 * (seeded PRNG, name-based ids, no clock reads), and every day yields the same
 * story shifted in time, so the demo always looks current.
 */
export function buildDemoDataset(now: Date): DemoDataset {
  const dataset: DemoDataset = {
    anchorDate: toIsoDate(startOfUtcDay(now)),
    projects: [],
    sprints: [],
    issues: [],
    issueEvents: [],
    issueComments: [],
    worklogs: [],
    pullRequests: [],
    commits: [],
    calendarEvents: [],
    docs: [],
    teams: [],
    people: [],
    teamMembers: [],
    statuses: [],
  };

  for (const spec of DEMO_PROJECT_SPECS) {
    const records = buildProjectRecords(spec, now);
    dataset.projects.push(records.project);
    dataset.sprints.push(...records.sprints);
    dataset.issues.push(...records.issues);
    dataset.issueEvents.push(...records.issueEvents);
    dataset.issueComments.push(...records.issueComments);
    dataset.worklogs.push(...records.worklogs);
    dataset.pullRequests.push(...records.pullRequests);
    dataset.commits.push(...records.commits);
    dataset.calendarEvents.push(...records.calendarEvents);
    dataset.docs.push(...records.docs);

    const team = buildTeamRecords(spec, now);
    dataset.teams.push(team.team);
    dataset.teamMembers.push(...team.teamMembers);
    dataset.statuses.push(...team.statuses);
    // People are organization-level: the same person in two projects is one
    // row, so the list is deduplicated by id.
    for (const person of team.people) {
      if (!dataset.people.some((other) => other.id === person.id)) {
        dataset.people.push(person);
      }
    }
  }

  return dataset;
}
