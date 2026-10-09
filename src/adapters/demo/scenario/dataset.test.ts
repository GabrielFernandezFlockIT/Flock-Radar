import { describe, expect, it } from "vitest";

import {
  CalendarEventSchema,
  CommitSchema,
  DocRefSchema,
  EvidenceSchema,
  IssueCommentSchema,
  IssueEventSchema,
  IssueSchema,
  ProjectSchema,
  PullRequestSchema,
  SprintSchema,
  WorklogSchema,
  addDays,
  addWorkingDays,
  fromIsoDate,
  isWorkingDay,
  startOfUtcDay,
  shortSha,
  toIsoDate,
  type Evidence,
} from "@/shared/domain";

import { buildProjectRecords } from "./builder";
import { buildDemoDataset, type DemoDataset } from "./dataset";
import { DEMO_SCENARIO_EXPECTATIONS as EXPECT } from "./expectations";
import { COBALT } from "./projects";

const NOW = new Date("2026-10-08T15:30:00Z"); // a Thursday
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// One anchor per weekday (Mon 2026-10-05 .. Sun 2026-10-11).
const WEEK = Array.from(
  { length: 7 },
  (_, index) => new Date(Date.UTC(2026, 9, 5 + index, 23, 59)),
);

function project(dataset: DemoDataset, jiraKey: string) {
  const found = dataset.projects.find((item) => item.jiraKey === jiraKey);
  if (!found) throw new Error(`missing project ${jiraKey}`);
  const of = <T extends { projectId: string }>(items: T[]) =>
    items.filter((item) => item.projectId === found.id);
  const sprints = of(dataset.sprints);
  const active = sprints.find((sprint) => sprint.state === "active");
  if (!active) throw new Error(`missing active sprint for ${jiraKey}`);
  const issues = of(dataset.issues);
  const people = new Set(issues.map((issue) => issue.assignee));
  return {
    project: found,
    sprints,
    active,
    issues,
    activeIssues: issues.filter((issue) => issue.sprintId === active.id),
    events: of(dataset.issueEvents),
    comments: of(dataset.issueComments),
    worklogs: of(dataset.worklogs),
    pullRequests: of(dataset.pullRequests),
    commits: of(dataset.commits),
    docs: of(dataset.docs),
    calendar: dataset.calendarEvents.filter((event) => people.has(event.person)),
  };
}

function points(items: Array<{ points: number | null }>): number {
  return items.reduce((sum, item) => sum + (item.points ?? 0), 0);
}

function anchorTime(dataset: DemoDataset): number {
  return fromIsoDate(dataset.anchorDate).getTime();
}

/** Full working days strictly after `timestamp`'s day and before `today`. */
function fullWorkingDaysSince(timestamp: number, today: Date): number {
  let count = 0;
  for (
    let day = addDays(startOfUtcDay(new Date(timestamp)), 1);
    day.getTime() < today.getTime();
    day = addDays(day, 1)
  ) {
    if (isWorkingDay(day)) count += 1;
  }
  return count;
}

describe("buildDemoDataset determinism", () => {
  it("returns deep-equal data for the same UTC day, whatever the time", () => {
    const morning = buildDemoDataset(new Date("2026-10-08T00:00:00Z"));
    const evening = buildDemoDataset(new Date("2026-10-08T23:59:59Z"));
    expect(evening).toEqual(morning);
    expect(buildDemoDataset(NOW)).toEqual(morning);
  });

  it("tells the same story on another day, shifted in time", () => {
    const today = buildDemoDataset(NOW);
    const tomorrow = buildDemoDataset(new Date(NOW.getTime() + DAY));
    expect(tomorrow).not.toEqual(today);
    expect(tomorrow.issues.map((issue) => issue.key)).toEqual(
      today.issues.map((issue) => issue.key),
    );
    expect(tomorrow.projects.map((item) => item.id)).toEqual(
      today.projects.map((item) => item.id),
    );
  });
});

describe.each(WEEK.map((date) => [toIsoDate(date), date] as const))(
  "demo dataset invariants anchored on %s",
  (_label, now) => {
    const dataset = buildDemoDataset(now);
    const anchor = anchorTime(dataset);

    it("validates every record against the domain schemas", () => {
      const checks = [
        [ProjectSchema, dataset.projects],
        [SprintSchema, dataset.sprints],
        [IssueSchema, dataset.issues],
        [IssueEventSchema, dataset.issueEvents],
        [IssueCommentSchema, dataset.issueComments],
        [WorklogSchema, dataset.worklogs],
        [PullRequestSchema, dataset.pullRequests],
        [CommitSchema, dataset.commits],
        [CalendarEventSchema, dataset.calendarEvents],
        [DocRefSchema, dataset.docs],
      ] as const;
      for (const [schema, items] of checks) {
        expect(items.length).toBeGreaterThan(0);
        for (const item of items) expect(() => schema.parse(item)).not.toThrow();
      }
    });

    it("turns every source record into valid evidence", () => {
      const evidence: Evidence[] = [
        ...dataset.issues.map((issue) => ({
          sourceType: "jira_issue" as const,
          externalId: issue.key,
          url: issue.url,
          occurredAt: issue.updatedAt,
        })),
        ...dataset.issueComments.map((comment) => ({
          sourceType: "jira_comment" as const,
          externalId: `${comment.issueKey}#${comment.id}`,
          url: comment.url,
          occurredAt: comment.createdAt,
        })),
        ...dataset.pullRequests.map((pr) => ({
          sourceType: "github_pr" as const,
          externalId: `#${pr.number}`,
          url: pr.url,
          occurredAt: pr.createdAt,
        })),
        ...dataset.commits.map((commit) => ({
          sourceType: "github_commit" as const,
          externalId: shortSha(commit.sha),
          url: commit.url,
          occurredAt: commit.committedAt,
        })),
        ...dataset.docs.map((doc) => ({
          sourceType: "doc" as const,
          externalId: doc.slug,
          url: doc.url,
          occurredAt: doc.updatedAt,
        })),
      ];
      for (const item of evidence) {
        expect(EvidenceSchema.safeParse(item).success, item.url).toBe(true);
      }
    });

    it("keeps all past activity strictly before today's midnight", () => {
      const past = [
        ...dataset.issues.flatMap((issue) => [
          issue.createdAt,
          issue.updatedAt,
          issue.resolvedAt,
        ]),
        ...dataset.issueEvents.map((event) => event.at),
        ...dataset.issueComments.map((comment) => comment.createdAt),
        ...dataset.worklogs.map((worklog) => worklog.startedAt),
        ...dataset.pullRequests.flatMap((pr) => [
          pr.createdAt,
          pr.firstReviewAt,
          pr.mergedAt,
        ]),
        ...dataset.commits.map((commit) => commit.committedAt),
        ...dataset.docs.map((doc) => doc.updatedAt),
      ].filter((value): value is string => value !== null);

      for (const timestamp of past) {
        expect(Date.parse(timestamp), timestamp).toBeLessThan(anchor);
      }
    });

    it("uses unique natural keys", () => {
      const unique = (values: string[]) => new Set(values).size === values.length;
      const scoped = <T extends { projectId: string }>(
        items: T[],
        key: (item: T) => string | number,
      ) => unique(items.map((item) => `${item.projectId}:${key(item)}`));

      expect(unique(dataset.projects.map((item) => item.id))).toBe(true);
      expect(unique(dataset.sprints.map((item) => item.id))).toBe(true);
      expect(scoped(dataset.issues, (item) => item.key)).toBe(true);
      expect(scoped(dataset.issueEvents, (item) => item.externalId)).toBe(true);
      expect(scoped(dataset.issueComments, (item) => item.id)).toBe(true);
      expect(scoped(dataset.worklogs, (item) => item.id)).toBe(true);
      expect(scoped(dataset.pullRequests, (item) => item.number)).toBe(true);
      expect(scoped(dataset.commits, (item) => item.sha)).toBe(true);
      expect(scoped(dataset.docs, (item) => item.slug)).toBe(true);
    });

    it("links records to existing parents", () => {
      const sprintIds = new Set(dataset.sprints.map((sprint) => sprint.id));
      const issueKeys = new Set(
        dataset.issues.map((issue) => `${issue.projectId}:${issue.key}`),
      );
      const exists = (projectId: string, key: string) =>
        issueKeys.has(`${projectId}:${key}`);

      for (const issue of dataset.issues) {
        if (issue.sprintId) expect(sprintIds.has(issue.sprintId)).toBe(true);
      }
      for (const record of [
        ...dataset.issueEvents,
        ...dataset.issueComments,
        ...dataset.worklogs,
      ]) {
        expect(exists(record.projectId, record.issueKey), record.issueKey).toBe(true);
      }
      for (const linked of [...dataset.pullRequests, ...dataset.commits]) {
        for (const key of linked.linkedIssueKeys) {
          expect(exists(linked.projectId, key), key).toBe(true);
        }
      }
    });

    it("links every merged PR to an issue except the scripted orphan", () => {
      const unlinked = dataset.pullRequests.filter(
        (pr) => pr.state === "merged" && pr.linkedIssueKeys.length === 0,
      );
      expect(unlinked.map((pr) => pr.title)).toEqual([
        EXPECT.beacon.orphanMergedPrTitle,
      ]);
    });

    it("backs every done code issue with a merged PR except the scripted one", () => {
      const merged = new Set(
        dataset.pullRequests
          .filter((pr) => pr.state === "merged")
          .flatMap((pr) => pr.linkedIssueKeys.map((key) => `${pr.projectId}:${key}`)),
      );
      const missing = dataset.issues.filter(
        (issue) =>
          issue.statusCategory === "done" &&
          issue.requiresCode &&
          !merged.has(`${issue.projectId}:${issue.key}`),
      );
      expect(missing.map((issue) => issue.key)).toEqual([
        EXPECT.cobalt.doneWithoutMergedPrIssueKey,
      ]);
    });

    it("has exactly one stale review and one stalled issue, both in Beacon", () => {
      const stale = dataset.pullRequests.filter(
        (pr) =>
          pr.state === "open" &&
          pr.firstReviewAt === null &&
          anchor - Date.parse(pr.createdAt) > EXPECT.beacon.staleReviewMinHours * HOUR,
      );
      expect(stale.flatMap((pr) => pr.linkedIssueKeys)).toEqual([
        EXPECT.beacon.staleReviewIssueKey,
      ]);
      // No other open PR is waiting for a first review at all.
      expect(
        dataset.pullRequests.filter(
          (pr) => pr.state === "open" && pr.firstReviewAt === null,
        ),
      ).toHaveLength(1);

      const lastCommitAt = (projectId: string, key: string) =>
        Math.max(
          ...dataset.commits
            .filter(
              (commit) =>
                commit.projectId === projectId && commit.linkedIssueKeys.includes(key),
            )
            .map((commit) => Date.parse(commit.committedAt)),
        );
      const today = fromIsoDate(dataset.anchorDate);
      const idleWorkingDays = (issue: { projectId: string; key: string }) =>
        fullWorkingDaysSince(lastCommitAt(issue.projectId, issue.key), today);
      const inProgress = dataset.issues.filter(
        (issue) => issue.statusCategory === "in_progress",
      );
      const stalled = inProgress.filter(
        (issue) =>
          idleWorkingDays(issue) >= EXPECT.beacon.stalledMinWorkingDaysWithoutCommits,
      );
      expect(stalled.map((issue) => issue.key)).toEqual([
        EXPECT.beacon.stalledIssueKey,
      ]);
      // Everything else in progress was committed to within 3 working days.
      for (const issue of inProgress) {
        if (issue.key === EXPECT.beacon.stalledIssueKey) continue;
        expect(idleWorkingDays(issue), issue.key).toBeLessThanOrEqual(3);
      }
    });

    it("keeps every sprint's commitment equal to what was planned at its start", () => {
      for (const sprint of dataset.sprints.filter((item) => item.state !== "future")) {
        const startAt = Date.parse(sprint.startAt);
        const events = dataset.issueEvents.filter(
          (event) => event.projectId === sprint.projectId,
        );
        const plannedKeys = new Set(
          events
            .filter(
              (event) =>
                event.field === "sprint" &&
                event.to === sprint.id &&
                Date.parse(event.at) <= startAt,
            )
            .map((event) => event.issueKey),
        );
        const initialPoints = (key: string) => {
          const reestimate = events.find(
            (event) =>
              event.issueKey === key &&
              event.field === "points" &&
              Date.parse(event.at) > startAt,
          );
          const issue = dataset.issues.find(
            (item) => item.projectId === sprint.projectId && item.key === key,
          );
          return reestimate ? Number(reestimate.from) : (issue?.points ?? 0);
        };
        const planned = [...plannedKeys].reduce((sum, key) => sum + initialPoints(key), 0);
        expect(planned, sprint.name).toBe(sprint.committedPoints);
      }
    });

    it("scripts Atlas as healthy with one unanswered question", () => {
      const atlas = project(dataset, EXPECT.atlas.jiraKey);
      expect(atlas.active.committedPoints).toBe(EXPECT.atlas.committedPoints);
      expect(points(atlas.activeIssues)).toBe(EXPECT.atlas.committedPoints);
      expect(
        points(atlas.activeIssues.filter((issue) => issue.statusCategory === "done")),
      ).toBe(EXPECT.atlas.donePoints);
      expect(
        atlas.activeIssues.filter((issue) => issue.statusCategory === "in_progress"),
      ).toHaveLength(EXPECT.atlas.inProgress);

      const closed = atlas.sprints.filter((sprint) => sprint.state === "closed");
      expect(closed).toHaveLength(EXPECT.atlas.closedSprints);
      for (const sprint of closed) {
        expect(sprint.committedPoints).toBeGreaterThanOrEqual(EXPECT.atlas.velocityPoints.min);
        expect(sprint.committedPoints).toBeLessThanOrEqual(EXPECT.atlas.velocityPoints.max);
      }

      const questions = atlas.comments.filter((comment) => comment.body.includes("?"));
      const unanswered = questions.filter(
        (question) =>
          !atlas.comments.some(
            (reply) =>
              reply.issueKey === question.issueKey &&
              reply.author !== question.author &&
              Date.parse(reply.createdAt) > Date.parse(question.createdAt),
          ),
      );
      expect(unanswered.map((comment) => comment.issueKey)).toEqual([
        EXPECT.atlas.unansweredQuestionIssueKey,
      ]);
      expect(anchor - Date.parse(unanswered[0].createdAt)).toBeGreaterThan(
        EXPECT.atlas.unansweredQuestionMinHours * HOUR,
      );
    });

    it("scripts Beacon's scope creep, PTO, and WIP", () => {
      const beacon = project(dataset, EXPECT.beacon.jiraKey);
      const sprintStart = Date.parse(beacon.active.startAt);
      const afterStart = beacon.events.filter((event) => Date.parse(event.at) > sprintStart);

      const added = afterStart.filter(
        (event) => event.field === "sprint" && event.to === beacon.active.id,
      );
      const addedPoints = Object.fromEntries(
        added.map((event) => [
          event.issueKey,
          beacon.issues.find((issue) => issue.key === event.issueKey)?.points,
        ]),
      );
      const reestimates = Object.fromEntries(
        afterStart
          .filter((event) => event.field === "points")
          .map((event) => [event.issueKey, Number(event.to) - Number(event.from)]),
      );

      expect(addedPoints).toEqual(EXPECT.beacon.scopeAddedIssues);
      expect(reestimates).toEqual(EXPECT.beacon.scopeReestimates);
      const creep = [...Object.values(addedPoints), ...Object.values(reestimates)].reduce(
        (sum: number, value) => sum + (value ?? 0),
        0,
      );
      expect(creep).toBe(EXPECT.beacon.scopeAddedPoints);
      expect(beacon.active.committedPoints).toBe(EXPECT.beacon.committedPointsAtStart);
      expect(points(beacon.activeIssues)).toBe(EXPECT.beacon.currentScopePoints);
      expect(
        points(beacon.activeIssues.filter((issue) => issue.statusCategory === "done")),
      ).toBe(EXPECT.beacon.donePoints);

      expect(
        beacon.activeIssues.filter((issue) => issue.statusCategory === "in_progress"),
      ).toHaveLength(EXPECT.beacon.inProgress);
      expect(EXPECT.beacon.inProgress).toBeGreaterThan(beacon.project.wipLimit);

      const sprintEnd = Date.parse(beacon.active.endAt);
      const pto = beacon.calendar.filter(
        (event) =>
          event.kind === "pto" &&
          Date.parse(event.start) >= anchor &&
          Date.parse(event.start) < sprintEnd,
      );
      const ptoPeople = [...new Set(pto.map((event) => event.person))].sort();
      expect(ptoPeople).toEqual([...EXPECT.beacon.ptoPeopleNames].sort());
      expect(ptoPeople).toHaveLength(EXPECT.beacon.ptoPeople);
      for (const person of ptoPeople) {
        expect(pto.filter((event) => event.person === person)).toHaveLength(
          EXPECT.beacon.ptoDaysPerPerson,
        );
      }
    });

    it("scripts Cobalt's accelerating burn toward early budget exhaustion", () => {
      const cobalt = project(dataset, EXPECT.cobalt.jiraKey);
      expect(cobalt.project.budgetAmount).toBe(EXPECT.cobalt.budgetAmount);
      expect(cobalt.project.hourlyRate).toBe(EXPECT.cobalt.hourlyRate);
      expect(cobalt.project.forecastUnit).toBe(EXPECT.cobalt.forecastUnit);

      const today = fromIsoDate(dataset.anchorDate);
      const windowStart = addWorkingDays(today, -EXPECT.cobalt.burnWindowWorkingDays);
      const hoursPerDay = new Map<string, number>();
      for (const worklog of cobalt.worklogs) {
        const day = worklog.startedAt.slice(0, 10);
        hoursPerDay.set(day, (hoursPerDay.get(day) ?? 0) + worklog.seconds / 3600);
      }
      const windowDays = [...hoursPerDay.keys()].filter(
        (day) => fromIsoDate(day) >= windowStart,
      );
      const beforeDays = [...hoursPerDay.keys()].filter(
        (day) => fromIsoDate(day) < windowStart,
      );
      const mean = (days: string[]) =>
        days.reduce((sum, day) => sum + (hoursPerDay.get(day) ?? 0), 0) / days.length;

      expect(windowDays).toHaveLength(EXPECT.cobalt.burnWindowWorkingDays);
      const recentBurn = mean(windowDays);
      expect(recentBurn / mean(beforeDays)).toBeGreaterThanOrEqual(
        EXPECT.cobalt.minBurnAcceleration,
      );

      const spentHours = [...hoursPerDay.values()].reduce((sum, hours) => sum + hours, 0);
      const budgetHours = EXPECT.cobalt.budgetAmount / EXPECT.cobalt.hourlyRate;
      const workingDaysLeft = (budgetHours - spentHours) / recentBurn;
      expect(workingDaysLeft).toBeCloseTo(EXPECT.cobalt.exhaustionWorkingDaysAhead, 0);
      expect(cobalt.project.endDate).toBe(
        toIsoDate(new Date(today.getTime() + EXPECT.cobalt.endOffsetDays * DAY)),
      );

      const lateJoiners = new Set<string>(EXPECT.cobalt.lateJoiners);
      for (const worklog of cobalt.worklogs) {
        if (lateJoiners.has(worklog.author)) {
          expect(Date.parse(worklog.startedAt)).toBeGreaterThanOrEqual(windowStart.getTime());
        }
      }

      const directCommit = cobalt.commits.find((commit) =>
        commit.linkedIssueKeys.includes(EXPECT.cobalt.doneWithoutMergedPrIssueKey),
      );
      expect(directCommit).toBeDefined();
      expect(cobalt.docs.filter((doc) => doc.title.startsWith("ADR"))).toHaveLength(
        EXPECT.cobalt.decisionDocs,
      );
      expect(
        cobalt.activeIssues.filter((issue) => issue.statusCategory === "in_progress").length,
      ).toBeLessThanOrEqual(cobalt.project.wipLimit);
    });
  },
);

describe("scenario builder robustness", () => {
  it("keeps the burn window exact for teams larger than five people", () => {
    const records = buildProjectRecords(
      {
        ...COBALT,
        people: [
          ...COBALT.people,
          { name: "Extra One", login: "extra-one", joinsLate: true },
          { name: "Extra Two", login: "extra-two", joinsLate: true },
        ],
      },
      NOW,
    );

    for (const worklog of records.worklogs) {
      expect(() => WorklogSchema.parse(worklog)).not.toThrow();
      expect(Number.isFinite(worklog.seconds)).toBe(true);
    }
    const today = fromIsoDate(toIsoDate(NOW));
    const windowStart = addWorkingDays(today, -EXPECT.cobalt.burnWindowWorkingDays);
    const extraHours = records.worklogs
      .filter((worklog) => worklog.author.startsWith("Extra"))
      .every((worklog) => Date.parse(worklog.startedAt) >= windowStart.getTime());
    expect(extraHours).toBe(true);
  });
});
