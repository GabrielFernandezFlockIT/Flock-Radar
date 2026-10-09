import { stableSha, stableUuid } from "@/adapters/shared/stable-ids";
import {
  DAY_MS,
  HOUR_MS,
  addDays,
  addWorkingDays,
  createRng,
  extractIssueKeys,
  isWorkingDay,
  issueRequiresCode,
  startOfUtcDay,
  toIsoDate,
  type CalendarEvent,
  type Commit,
  type DocRef,
  type Issue,
  type IssueComment,
  type IssueEvent,
  type IssueEventField,
  type Project,
  type PullRequest,
  type Rng,
  type Sprint,
  type StatusCategory,
  type Worklog,
} from "@/shared/domain";

import type {
  CommentTime,
  DemoIssueType,
  DemoPerson,
  PlannedIssue,
  ProjectSpec,
} from "./spec";

/**
 * Turns a `ProjectSpec` into domain records anchored to `now`.
 *
 * Determinism: the only inputs are the spec and the UTC day of `now`; all
 * randomness comes from a PRNG seeded with the project slug, and every id is a
 * name-based UUID or SHA. Nothing here reads the clock or `Math.random`.
 *
 * Time model (UTC): the active sprint has 10 working days and today is
 * always its day 6, so days 1-5 already happened. Every past timestamp is
 * strictly before today's midnight, so the dataset never contains "future"
 * activity no matter what time of day the demo runs.
 */

export const DEMO_JIRA_BASE_URL = "https://demo.atlassian.net";
export const DEMO_GITHUB_BASE_URL = "https://github.com";
export const DEMO_DOCS_BASE_URL = "https://flocktools.demo/docs";

/** Today is working day 6 of the active sprint. */
export const ACTIVE_SPRINT_DAY = 6;
export const SPRINT_WORKING_DAYS = 10;
/** Active-sprint issues are numbered from here (`BCN-301`, ...). */
export const ACTIVE_KEY_BASE = 300;

export interface ProjectRecords {
  project: Project;
  sprints: Sprint[];
  issues: Issue[];
  issueEvents: IssueEvent[];
  issueComments: IssueComment[];
  worklogs: Worklog[];
  pullRequests: PullRequest[];
  commits: Commit[];
  calendarEvents: CalendarEvent[];
  docs: DocRef[];
}

const POINT_OPTIONS: Record<DemoIssueType, readonly number[]> = {
  Story: [2, 3, 5, 8],
  Bug: [1, 2, 3],
  Task: [1, 2, 3],
  Spike: [2, 3],
};

const TYPE_WEIGHTS: ReadonlyArray<readonly [DemoIssueType, number]> = [
  ["Story", 0.45],
  ["Task", 0.25],
  ["Bug", 0.22],
  ["Spike", 0.08],
];

const STATUS_TODO = "To Do";
const STATUS_IN_PROGRESS = "In Progress";
const STATUS_IN_REVIEW = "In Review";
const STATUS_DONE = "Done";

const HOURLY_NOISE: readonly number[] = [-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75];
const WINDOW_OFFSETS: readonly number[] = [0.5, -0.5, 0.25, -0.25, 0];

/** The scripted stalled issue's last commit, in working days before today. */
const STALLED_LAST_COMMIT_WORKING_DAYS_AGO = 7;

interface SprintInfo {
  sprint: Sprint;
  startDay: Date;
}

interface IssueTimeline {
  key: string;
  assignee: string | null;
  createdAt: Date;
  startedAt: Date | null;
  resolvedAt: Date | null;
  sprintId: string | null;
}

interface PrDraft {
  title: string;
  branch: string;
  author: string;
  createdAt: Date;
  firstReviewAt: Date | null;
  mergedAt: Date | null;
  commitShas: string[];
  mergeSha: string | null;
}

interface IssueInput {
  key: string;
  type: DemoIssueType;
  title: string;
  points: number;
  assignee: string | null;
  status: string;
  statusCategory: StatusCategory;
  createdAt: Date;
  resolvedAt: Date | null;
  sprintId: string | null;
  startedAt: Date | null;
}

/** Rounds to the minute so timestamps look like real tool output. */
function minute(time: number): Date {
  return new Date(Math.round(time / 60_000) * 60_000);
}

/** `day` (midnight UTC) plus a fractional number of hours. */
function at(day: Date, hour: number): Date {
  return minute(day.getTime() + hour * HOUR_MS);
}

function iso(date: Date): string {
  return date.toISOString();
}

function lastWorkingDayOnOrBefore(date: Date): Date {
  let cursor = startOfUtcDay(date);
  while (!isWorkingDay(cursor)) cursor = addDays(cursor, -1);
  return cursor;
}

function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

class ProjectGenerator {
  private readonly rng: Rng;
  private readonly projectId: string;
  private readonly today: Date;
  private readonly activeStart: Date;
  private readonly lead: DemoPerson;

  private readonly sprintInfos: SprintInfo[] = [];
  private active!: SprintInfo;
  private previous!: SprintInfo;
  private future!: SprintInfo;

  private readonly issues: Issue[] = [];
  private readonly events: IssueEvent[] = [];
  private readonly comments: IssueComment[] = [];
  private readonly worklogs: Worklog[] = [];
  private readonly commits: Commit[] = [];
  private readonly prDrafts: PrDraft[] = [];
  private readonly calendar: CalendarEvent[] = [];
  private readonly timelines: IssueTimeline[] = [];

  private historyKeyCounter = 0;
  private readonly eventCounters = new Map<string, number>();
  private readonly titleRounds = new Map<DemoIssueType, number>();
  private readonly titleQueues = new Map<DemoIssueType, string[]>();

  constructor(
    private readonly spec: ProjectSpec,
    now: Date,
  ) {
    this.rng = createRng(`radar-demo:${spec.slug}`);
    this.projectId = stableUuid("demo", "project", spec.slug);
    this.today = startOfUtcDay(now);
    this.activeStart = addWorkingDays(this.today, -(ACTIVE_SPRINT_DAY - 1));
    this.lead = spec.people[0];
  }

  build(): ProjectRecords {
    this.buildSprints();
    for (const info of this.sprintInfos) {
      if (info.sprint.state === "closed") this.buildHistorySprint(info);
    }
    this.buildActiveSprint();
    this.buildBacklog();
    this.buildOrphanPullRequest();
    const pullRequests = this.finalizePullRequests();
    this.buildComments();
    this.buildWorklogs();
    this.buildCalendar();

    const firstSprint = this.sprintInfos[0];
    const project: Project = {
      id: this.projectId,
      name: this.spec.name,
      jiraKey: this.spec.jiraKey,
      githubRepo: this.spec.githubRepo,
      clientName: this.spec.clientName,
      budgetAmount: this.spec.budgetAmount,
      budgetCurrency: "USD",
      hourlyRate: this.spec.hourlyRate,
      startDate: toIsoDate(firstSprint.startDay),
      endDate: toIsoDate(addDays(this.today, this.spec.endOffsetDays)),
      forecastUnit: this.spec.forecastUnit,
      wipLimit: this.spec.wipLimit,
      boardId: this.spec.boardId,
    };

    return {
      project,
      sprints: this.sprintInfos.map((info) => info.sprint),
      issues: this.issues,
      issueEvents: this.events,
      issueComments: this.comments,
      worklogs: this.worklogs,
      pullRequests,
      commits: this.commits,
      calendarEvents: this.calendar,
      docs: this.buildDocs(),
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private activeDay(day: number): Date {
    return addWorkingDays(this.activeStart, day - 1);
  }

  private sprintDay(info: SprintInfo, day: number): Date {
    return addWorkingDays(info.startDay, day - 1);
  }

  private issueUrl(key: string): string {
    return `${DEMO_JIRA_BASE_URL}/browse/${key}`;
  }

  private repoUrl(): string {
    return `${DEMO_GITHUB_BASE_URL}/${this.spec.githubRepo}`;
  }

  private person(index: number): DemoPerson {
    const person = this.spec.people[index];
    if (!person) {
      throw new Error(`${this.spec.slug}: unknown person index ${index}`);
    }
    return person;
  }

  private windowStart(): Date | null {
    const burn = this.spec.burn;
    return burn.kind === "accelerating"
      ? addWorkingDays(this.today, -burn.windowWorkingDays)
      : null;
  }

  private peopleOn(day: Date): DemoPerson[] {
    const windowStart = this.windowStart();
    return this.spec.people.filter(
      (person) =>
        !person.joinsLate ||
        (windowStart !== null && day.getTime() >= windowStart.getTime()),
    );
  }

  private nextTitle(type: DemoIssueType): string {
    let queue = this.titleQueues.get(type);
    if (!queue || queue.length === 0) {
      const round = (this.titleRounds.get(type) ?? 0) + 1;
      this.titleRounds.set(type, round);
      const suffix = round === 1 ? "" : ` (part ${round})`;
      queue = this.rng
        .shuffle(this.spec.titles[type])
        .map((title) => `${title}${suffix}`);
      this.titleQueues.set(type, queue);
    }
    const title = queue.shift();
    if (!title) throw new Error(`${this.spec.slug}: no titles for ${type}`);
    return title;
  }

  private pickType(): DemoIssueType {
    const roll = this.rng.next();
    let cumulative = 0;
    for (const [type, weight] of TYPE_WEIGHTS) {
      cumulative += weight;
      if (roll < cumulative) return type;
    }
    return "Story";
  }

  /** Splits a sprint's points into issue-sized pieces that sum exactly. */
  private splitPoints(target: number): Array<{ type: DemoIssueType; points: number }> {
    const pieces: Array<{ type: DemoIssueType; points: number }> = [];
    let remaining = target;
    while (remaining > 0) {
      let type = this.pickType();
      let options = POINT_OPTIONS[type].filter((points) => points <= remaining);
      if (options.length === 0) {
        type = this.rng.pick(["Bug", "Task"] as const);
        options = POINT_OPTIONS[type].filter((points) => points <= remaining);
      }
      const points = this.rng.pick(options);
      pieces.push({ type, points });
      remaining -= points;
    }
    return pieces;
  }

  private event(
    key: string,
    field: IssueEventField,
    from: string | null,
    to: string | null,
    when: Date,
    author: string | null,
  ): void {
    const index = (this.eventCounters.get(key) ?? 0) + 1;
    this.eventCounters.set(key, index);
    this.events.push({
      projectId: this.projectId,
      externalId: `${key}#${index}`,
      issueKey: key,
      field,
      from,
      to,
      at: iso(when),
      author,
    });
  }

  private commit(
    sha: string,
    author: string,
    message: string,
    when: Date,
  ): void {
    this.commits.push({
      projectId: this.projectId,
      sha,
      author,
      message,
      committedAt: iso(when),
      linkedIssueKeys: extractIssueKeys(message, [this.spec.jiraKey]),
      url: `${this.repoUrl()}/commit/${sha}`,
    });
  }

  /**
   * Feature commits spread evenly over (from, to], the last one exactly at
   * `to`; returns their SHAs.
   */
  private featureCommits(
    key: string,
    title: string,
    author: string,
    from: Date,
    to: Date,
    count: number,
  ): string[] {
    const messages = [
      `${key}: ${title}`,
      `${key}: add tests`,
      `${key}: address review feedback`,
    ];
    const shas: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const sha = stableSha(this.spec.slug, key, "commit", String(index));
      const when = minute(
        from.getTime() + ((to.getTime() - from.getTime()) * (index + 1)) / count,
      );
      this.commit(sha, author, messages[index % messages.length], when);
      shas.push(sha);
    }
    return shas;
  }

  private addIssue(input: IssueInput, lastActivity: Date): void {
    this.issues.push({
      projectId: this.projectId,
      key: input.key,
      title: input.title,
      type: input.type,
      status: input.status,
      statusCategory: input.statusCategory,
      points: input.points,
      assignee: input.assignee,
      createdAt: iso(input.createdAt),
      updatedAt: iso(lastActivity),
      resolvedAt: input.resolvedAt ? iso(input.resolvedAt) : null,
      url: this.issueUrl(input.key),
      sprintId: input.sprintId,
      requiresCode: issueRequiresCode(input.type),
    });
    this.timelines.push({
      key: input.key,
      assignee: input.assignee,
      createdAt: input.createdAt,
      startedAt: input.startedAt,
      resolvedAt: input.resolvedAt,
      sprintId: input.sprintId,
    });
  }

  /**
   * A finished issue with its full evidence chain: transitions, and for code
   * work a merged PR with feature commits and a merge commit.
   */
  private addFinishedWork(options: {
    key: string;
    type: DemoIssueType;
    title: string;
    points: number;
    assignee: DemoPerson;
    createdAt: Date;
    sprintId: string;
    startedAt: Date;
    resolvedAt: Date;
    withPullRequest: boolean;
  }): void {
    const { key, title, assignee, startedAt, resolvedAt } = options;
    this.event(key, "status", STATUS_TODO, STATUS_IN_PROGRESS, startedAt, assignee.name);

    if (options.withPullRequest) {
      const prCreatedAt = minute(
        startedAt.getTime() + (resolvedAt.getTime() - startedAt.getTime()) * 0.55,
      );
      const mergedAt = minute(resolvedAt.getTime() - 15 * 60_000);
      const firstReviewAt = minute(
        prCreatedAt.getTime() +
          (mergedAt.getTime() - prCreatedAt.getTime()) * this.rng.float(0.2, 0.6),
      );
      const commitShas = this.featureCommits(
        key,
        title,
        assignee.login,
        startedAt,
        minute(prCreatedAt.getTime() - 10 * 60_000),
        this.rng.int(1, 3),
      );
      this.prDrafts.push({
        title: `${key}: ${title}`,
        branch: `${key.toLowerCase()}-${slugify(title)}`,
        author: assignee.login,
        createdAt: prCreatedAt,
        firstReviewAt,
        mergedAt,
        commitShas,
        mergeSha: stableSha(this.spec.slug, key, "merge"),
      });
      this.event(key, "status", STATUS_IN_PROGRESS, STATUS_IN_REVIEW, prCreatedAt, assignee.name);
      this.event(key, "status", STATUS_IN_REVIEW, STATUS_DONE, resolvedAt, assignee.name);
    } else {
      this.event(key, "status", STATUS_IN_PROGRESS, STATUS_DONE, resolvedAt, assignee.name);
    }
    this.event(key, "resolution", null, "Done", resolvedAt, assignee.name);

    this.addIssue(
      {
        key,
        type: options.type,
        title,
        points: options.points,
        assignee: assignee.name,
        status: STATUS_DONE,
        statusCategory: "done",
        createdAt: options.createdAt,
        resolvedAt,
        sprintId: options.sprintId,
        startedAt,
      },
      resolvedAt,
    );
  }

  // ---------------------------------------------------------------------------
  // Sprints
  // ---------------------------------------------------------------------------

  private buildSprints(): void {
    const total = this.spec.historySprints + 2; // history + active + future
    for (let index = 0; index < total; index += 1) {
      const offset = index - this.spec.historySprints; // 0 = active
      const startDay = addWorkingDays(this.activeStart, offset * SPRINT_WORKING_DAYS);
      const endDay = addWorkingDays(startDay, SPRINT_WORKING_DAYS - 1);
      const number = this.spec.sprintNumberBase + index;
      const state = offset < 0 ? "closed" : offset === 0 ? "active" : "future";
      const sprint: Sprint = {
        id: stableUuid("demo", "sprint", this.spec.slug, String(number)),
        projectId: this.projectId,
        externalId: String(this.spec.jiraSprintIdBase + index),
        name: `${this.spec.jiraKey} Sprint ${number}`,
        goal: offset === 0 ? this.spec.activeSprintGoal : null,
        startAt: iso(at(startDay, 9)),
        endAt: iso(at(endDay, 18)),
        state,
        committedPoints: null,
      };
      this.sprintInfos.push({ sprint, startDay });
    }
    this.active = this.sprintInfos[this.spec.historySprints];
    this.previous = this.sprintInfos[this.spec.historySprints - 1];
    this.future = this.sprintInfos[this.spec.historySprints + 1];
  }

  private planningTime(info: SprintInfo): Date {
    return minute(Date.parse(info.sprint.startAt) - 15 * 60_000);
  }

  // ---------------------------------------------------------------------------
  // Closed sprints: steady history with complete evidence chains
  // ---------------------------------------------------------------------------

  private buildHistorySprint(info: SprintInfo): void {
    const target = this.rng.int(
      this.spec.historyVelocity.min,
      this.spec.historyVelocity.max,
    );
    const pieces = this.splitPoints(target);
    const createdBase = at(addWorkingDays(info.startDay, -1), 14);
    const planning = this.planningTime(info);
    const team = this.peopleOn(info.startDay);
    let goal: string | null = null;

    pieces.forEach((piece, index) => {
      this.historyKeyCounter += 1;
      const key = `${this.spec.jiraKey}-${this.historyKeyCounter}`;
      const title = this.nextTitle(piece.type);
      goal ??= piece.type === "Story" ? title : null;
      const resolveDay = this.rng.int(1, SPRINT_WORKING_DAYS);
      const startDay = Math.max(1, resolveDay - this.rng.int(0, 2));
      const assignee = this.rng.pick(team);

      this.event(key, "sprint", null, info.sprint.id, planning, this.lead.name);
      this.addFinishedWork({
        key,
        type: piece.type,
        title,
        points: piece.points,
        assignee,
        createdAt: minute(createdBase.getTime() + index * 10 * 60_000),
        sprintId: info.sprint.id,
        startedAt: at(this.sprintDay(info, startDay), this.rng.float(9.5, 11.5)),
        resolvedAt: at(this.sprintDay(info, resolveDay), this.rng.float(13, 17.5)),
        withPullRequest: issueRequiresCode(piece.type),
      });
    });

    info.sprint.committedPoints = target;
    info.sprint.goal = goal ? `Deliver ${lowerFirst(goal)}` : "Stabilize and ship";
  }

  // ---------------------------------------------------------------------------
  // Active sprint: scripted plan
  // ---------------------------------------------------------------------------

  private buildActiveSprint(): void {
    const createdBase = at(addWorkingDays(this.activeStart, -1), 14);
    const planning = this.planningTime(this.active);
    let committed = 0;

    this.spec.activePlan.forEach((plan, index) => {
      const key = `${this.spec.jiraKey}-${ACTIVE_KEY_BASE + index + 1}`;
      const assignee = this.person(plan.assignee);
      const initialPoints = plan.initialPoints ?? plan.points;

      let createdAt: Date;
      if (plan.addedOnDay !== undefined) {
        createdAt = at(this.activeDay(plan.addedOnDay), 10);
        this.event(
          key,
          "sprint",
          null,
          this.active.sprint.id,
          at(this.activeDay(plan.addedOnDay), 10.5),
          this.lead.name,
        );
      } else if (plan.carriedOver) {
        createdAt = at(addWorkingDays(this.previous.startDay, -1), 15);
        this.event(key, "sprint", null, this.previous.sprint.id, this.planningTime(this.previous), this.lead.name);
        this.event(
          key,
          "sprint",
          this.previous.sprint.id,
          this.active.sprint.id,
          minute(planning.getTime() + 5 * 60_000),
          this.lead.name,
        );
        committed += initialPoints;
        // It was planned into the previous sprint too: keep that commitment honest.
        this.previous.sprint.committedPoints =
          (this.previous.sprint.committedPoints ?? 0) + initialPoints;
      } else {
        createdAt = minute(createdBase.getTime() + index * 10 * 60_000);
        this.event(key, "sprint", null, this.active.sprint.id, planning, this.lead.name);
        committed += initialPoints;
      }

      if (plan.reestimatedOnDay !== undefined && plan.initialPoints !== undefined) {
        this.event(
          key,
          "points",
          String(plan.initialPoints),
          String(plan.points),
          at(this.activeDay(plan.reestimatedOnDay), 11.25),
          this.lead.name,
        );
      }

      this.buildPlannedIssue(plan, key, assignee, createdAt);
    });

    this.active.sprint.committedPoints = committed;
  }

  private requireDay(plan: PlannedIssue, day: number | undefined, field: string): number {
    if (day === undefined) {
      throw new Error(`${this.spec.slug}: "${plan.title}" needs ${field}`);
    }
    if (day < 1 || day >= ACTIVE_SPRINT_DAY) {
      throw new Error(`${this.spec.slug}: "${plan.title}" ${field} must be a past day (1-5)`);
    }
    return day;
  }

  /** Work starts at 10:00, or 11:00 when the issue was added that same morning. */
  private workStart(plan: PlannedIssue, startDay: number): Date {
    return at(this.activeDay(startDay), plan.addedOnDay === startDay ? 11 : 10);
  }

  private buildPlannedIssue(
    plan: PlannedIssue,
    key: string,
    assignee: DemoPerson,
    createdAt: Date,
  ): void {
    const sprintId = this.active.sprint.id;
    const base = {
      key,
      type: plan.type,
      title: plan.title,
      points: plan.points,
      assignee: assignee.name,
      createdAt,
      sprintId,
    };
    const lastElapsedDay = this.activeDay(ACTIVE_SPRINT_DAY - 1);

    switch (plan.state) {
      case "todo": {
        this.addIssue(
          {
            ...base,
            status: STATUS_TODO,
            statusCategory: "todo",
            resolvedAt: null,
            startedAt: null,
          },
          this.lastEventTime(key) ?? createdAt,
        );
        return;
      }

      case "done": {
        const startDay = this.requireDay(plan, plan.startedOnDay, "startedOnDay");
        const doneDay = this.requireDay(plan, plan.doneOnDay, "doneOnDay");
        const startedAt = this.workStart(plan, startDay);
        const resolvedAt = at(this.activeDay(doneDay), 16);

        if (plan.script === "done_without_pr") {
          // Pushed straight to the default branch: a commit, but no PR.
          this.event(key, "status", STATUS_TODO, STATUS_IN_PROGRESS, startedAt, assignee.name);
          this.commit(
            stableSha(this.spec.slug, key, "direct"),
            assignee.login,
            `${key}: ${plan.title}`,
            at(this.activeDay(doneDay), 15),
          );
          this.event(key, "status", STATUS_IN_PROGRESS, STATUS_DONE, resolvedAt, assignee.name);
          this.event(key, "resolution", null, "Done", resolvedAt, assignee.name);
          this.addIssue(
            {
              ...base,
              status: STATUS_DONE,
              statusCategory: "done",
              resolvedAt,
              startedAt,
            },
            resolvedAt,
          );
          return;
        }

        this.addFinishedWork({
          ...base,
          assignee,
          startedAt,
          resolvedAt,
          withPullRequest: issueRequiresCode(plan.type),
        });
        return;
      }

      case "in_progress": {
        let startedAt: Date;
        if (plan.script === "stalled") {
          // Last commit 7 working days before today: at least 5 full working
          // days without commits on any weekday the demo runs.
          const lastCommitDay = addWorkingDays(this.today, -STALLED_LAST_COMMIT_WORKING_DAYS_AGO);
          startedAt = at(addWorkingDays(lastCommitDay, -1), 10);
          this.featureCommits(key, plan.title, assignee.login, startedAt, at(lastCommitDay, 16), 2);
        } else {
          const startDay = this.requireDay(plan, plan.startedOnDay, "startedOnDay");
          startedAt = this.workStart(plan, startDay);
          // Fresh work: the latest commit is always on the last working day.
          this.featureCommits(
            key,
            plan.title,
            assignee.login,
            startedAt,
            at(lastElapsedDay, 17),
            startDay === ACTIVE_SPRINT_DAY - 1 ? 1 : 2,
          );
        }
        this.event(key, "status", STATUS_TODO, STATUS_IN_PROGRESS, startedAt, assignee.name);
        this.addIssue(
          {
            ...base,
            status: STATUS_IN_PROGRESS,
            statusCategory: "in_progress",
            resolvedAt: null,
            startedAt,
          },
          this.lastEventTime(key) ?? startedAt,
        );
        return;
      }

      case "in_review": {
        let prCreatedAt: Date;
        let startedAt: Date;
        let firstReviewAt: Date | null;
        if (plan.script === "stale_review") {
          // Opened at least 54.5h before today's midnight, never reviewed.
          const prDay = lastWorkingDayOnOrBefore(addDays(this.today, -3));
          prCreatedAt = at(prDay, 17.5);
          startedAt = at(addWorkingDays(prDay, -1), 10);
          firstReviewAt = null;
        } else {
          const startDay = this.requireDay(plan, plan.startedOnDay, "startedOnDay");
          const prDay = this.requireDay(plan, plan.prOnDay, "prOnDay");
          startedAt = this.workStart(plan, startDay);
          prCreatedAt = at(this.activeDay(prDay), 11);
          firstReviewAt = at(this.activeDay(prDay), 14.5);
        }
        const commitShas = this.featureCommits(
          key,
          plan.title,
          assignee.login,
          startedAt,
          minute(prCreatedAt.getTime() - 10 * 60_000),
          2,
        );
        this.prDrafts.push({
          title: `${key}: ${plan.title}`,
          branch: `${key.toLowerCase()}-${slugify(plan.title)}`,
          author: assignee.login,
          createdAt: prCreatedAt,
          firstReviewAt,
          mergedAt: null,
          commitShas,
          mergeSha: null,
        });
        this.event(key, "status", STATUS_TODO, STATUS_IN_PROGRESS, startedAt, assignee.name);
        this.event(key, "status", STATUS_IN_PROGRESS, STATUS_IN_REVIEW, prCreatedAt, assignee.name);
        this.addIssue(
          {
            ...base,
            status: STATUS_IN_REVIEW,
            statusCategory: "in_progress",
            resolvedAt: null,
            startedAt,
          },
          this.lastEventTime(key) ?? prCreatedAt,
        );
        return;
      }
    }
  }

  private lastEventTime(key: string): Date | null {
    let latest: number | null = null;
    for (const event of this.events) {
      if (event.issueKey !== key) continue;
      const time = Date.parse(event.at);
      if (latest === null || time > latest) latest = time;
    }
    return latest === null ? null : new Date(latest);
  }

  private buildBacklog(): void {
    const offset = ACTIVE_KEY_BASE + this.spec.activePlan.length;
    this.spec.backlog.forEach((item, index) => {
      const key = `${this.spec.jiraKey}-${offset + index + 1}`;
      const createdAt = at(this.activeDay((index % (ACTIVE_SPRINT_DAY - 1)) + 1), 12 + index * 0.25);
      let sprintId: string | null = null;
      let lastActivity = createdAt;
      if (item.nextSprint) {
        sprintId = this.future.sprint.id;
        lastActivity = at(this.activeDay(ACTIVE_SPRINT_DAY - 1), 16 + index * 0.1);
        this.event(key, "sprint", null, sprintId, lastActivity, this.lead.name);
      }
      this.addIssue(
        {
          key,
          type: item.type,
          title: item.title,
          points: item.points,
          assignee: null,
          status: STATUS_TODO,
          statusCategory: "todo",
          createdAt,
          resolvedAt: null,
          sprintId,
          startedAt: null,
        },
        lastActivity,
      );
    });
  }

  private buildOrphanPullRequest(): void {
    const orphan = this.spec.orphanPullRequest;
    if (!orphan) return;
    const author = this.person(orphan.author);
    const createdAt = at(this.activeDay(orphan.openedOnDay), 11);
    const mergedAt = at(this.activeDay(orphan.mergedOnDay), 16);
    const sha = stableSha(this.spec.slug, "orphan", orphan.branch);
    this.commit(sha, author.login, orphan.title, at(this.activeDay(orphan.openedOnDay), 10.5));
    this.prDrafts.push({
      title: orphan.title,
      branch: orphan.branch,
      author: author.login,
      createdAt,
      firstReviewAt: at(this.activeDay(orphan.openedOnDay), 13),
      mergedAt,
      commitShas: [sha],
      mergeSha: stableSha(this.spec.slug, "orphan-merge", orphan.branch),
    });
  }

  /** Numbers PRs chronologically and adds merge commits. */
  private finalizePullRequests(): PullRequest[] {
    const owner = this.spec.githubRepo.split("/")[0];
    const drafts = [...this.prDrafts].sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.title.localeCompare(b.title),
    );

    return drafts.map((draft, index) => {
      const number = this.spec.prNumberBase + index;
      if (draft.mergedAt && draft.mergeSha) {
        this.commit(
          draft.mergeSha,
          draft.author,
          `Merge pull request #${number} from ${owner}/${draft.branch}\n\n${draft.title}`,
          draft.mergedAt,
        );
      }
      return {
        projectId: this.projectId,
        number,
        title: draft.title,
        state: draft.mergedAt ? "merged" : "open",
        author: draft.author,
        createdAt: iso(draft.createdAt),
        mergedAt: draft.mergedAt ? iso(draft.mergedAt) : null,
        firstReviewAt: draft.firstReviewAt ? iso(draft.firstReviewAt) : null,
        linkedIssueKeys: extractIssueKeys(`${draft.title} ${draft.branch}`, [
          this.spec.jiraKey,
        ]),
        url: `${this.repoUrl()}/pull/${number}`,
        headSha: draft.commitShas.at(-1),
        mergeCommitSha: draft.mergeSha ?? undefined,
      } satisfies PullRequest;
    });
  }

  // ---------------------------------------------------------------------------
  // Comments, worklogs, calendar, docs
  // ---------------------------------------------------------------------------

  private commentTime(time: CommentTime): Date {
    if ("day" in time) {
      if (time.day < 1 || time.day >= ACTIVE_SPRINT_DAY) {
        throw new Error(`${this.spec.slug}: comment day must be 1-5`);
      }
      return at(this.activeDay(time.day), time.hour);
    }
    return at(lastWorkingDayOnOrBefore(addDays(this.today, -time.daysAgo)), time.hour);
  }

  private buildComments(): void {
    this.spec.comments.forEach((script, index) => {
      const key = `${this.spec.jiraKey}-${ACTIVE_KEY_BASE + script.planIndex + 1}`;
      const id = String(10_000 + index + 1);
      this.comments.push({
        projectId: this.projectId,
        issueKey: key,
        id,
        author: this.person(script.author).name,
        body: script.body,
        createdAt: iso(this.commentTime(script.at)),
        url: `${this.issueUrl(key)}?focusedCommentId=${id}`,
      });
    });
  }

  private sprintOn(day: Date): SprintInfo | undefined {
    const time = day.getTime();
    return this.sprintInfos.find(
      (info) =>
        time >= info.startDay.getTime() &&
        time <= addWorkingDays(info.startDay, SPRINT_WORKING_DAYS - 1).getTime(),
    );
  }

  private worklogIssue(person: DemoPerson, day: Date): string {
    const dayStart = day.getTime();
    const dayEnd = dayStart + DAY_MS;
    const sprintId = this.sprintOn(day)?.sprint.id ?? null;
    const existed = (timeline: IssueTimeline) =>
      timeline.createdAt.getTime() < dayEnd;

    const working = this.timelines.filter(
      (timeline) =>
        timeline.assignee === person.name &&
        timeline.startedAt !== null &&
        timeline.startedAt.getTime() < dayEnd &&
        (timeline.resolvedAt === null || timeline.resolvedAt.getTime() >= dayStart),
    );
    const assignedInSprint = this.timelines.filter(
      (timeline) =>
        timeline.assignee === person.name &&
        timeline.sprintId === sprintId &&
        existed(timeline),
    );
    const inSprint = this.timelines.filter(
      (timeline) => timeline.sprintId === sprintId && existed(timeline),
    );
    const candidates = [working, assignedInSprint, inSprint, this.timelines].find(
      (list) => list.length > 0,
    );
    if (!candidates) throw new Error(`${this.spec.slug}: no issues for worklogs`);
    return this.rng.pick(candidates).key;
  }

  private pushWorklog(person: DemoPerson, day: Date, hours: number, slot: number): number {
    const seconds = Math.max(60, Math.round(hours * 60) * 60);
    this.worklogs.push({
      projectId: this.projectId,
      issueKey: this.worklogIssue(person, day),
      id: String(100_000 + this.worklogs.length + 1),
      author: person.name,
      seconds,
      startedAt: iso(at(day, 9 + slot * 0.1)),
    });
    return seconds / 3600;
  }

  private buildWorklogs(): void {
    const burn = this.spec.burn;
    const firstDay = this.sprintInfos[0].startDay;
    const lastDay = addWorkingDays(this.today, -1);
    const windowStart = this.windowStart();
    const days: Date[] = [];
    for (let day = firstDay; day.getTime() <= lastDay.getTime(); day = addDays(day, 1)) {
      if (isWorkingDay(day)) days.push(day);
    }

    const steadyDay = (day: Date): number => {
      let total = 0;
      this.peopleOn(day).forEach((person, slot) => {
        const hours = burn.hoursPerPersonDay + this.rng.pick(HOURLY_NOISE);
        total += this.pushWorklog(person, day, hours, slot);
      });
      return total;
    };

    if (burn.kind === "steady" || windowStart === null) {
      days.forEach(steadyDay);
      return;
    }

    // Accelerating burn: steady before the window, then a higher daily burn
    // sized so the remaining budget lasts exactly `exhaustionWorkingDaysAhead`
    // working days at that pace.
    let spentHours = 0;
    const windowDays: Date[] = [];
    for (const day of days) {
      if (day.getTime() < windowStart.getTime()) spentHours += steadyDay(day);
      else windowDays.push(day);
    }
    const budgetHours = this.spec.budgetAmount / this.spec.hourlyRate;
    const dailyBurn =
      (budgetHours - spentHours) /
      (windowDays.length + burn.exhaustionWorkingDaysAhead);

    for (const day of windowDays) {
      const team = this.peopleOn(day);
      const share = dailyBurn / team.length;
      // One offset per person (0 beyond the predefined ones), zero-sum so
      // the day's total stays exactly `dailyBurn` for any team size.
      const raw = team.map((_, index) => WINDOW_OFFSETS[index] ?? 0);
      const offsets = this.rng.shuffle(
        raw.map((offset, index) =>
          index === raw.length - 1
            ? -raw.slice(0, -1).reduce((sum, value) => sum + value, 0)
            : offset,
        ),
      );
      team.forEach((person, slot) => {
        this.pushWorklog(person, day, share + offsets[slot], slot);
      });
    }
  }

  private buildCalendar(): void {
    const first = this.previous;
    const last = this.future;
    const rangeEnd = addWorkingDays(last.startDay, SPRINT_WORKING_DAYS - 1);

    for (const person of this.spec.people) {
      for (
        let day = first.startDay;
        day.getTime() <= rangeEnd.getTime();
        day = addDays(day, 1)
      ) {
        if (!isWorkingDay(day)) continue;
        this.calendar.push({
          person: person.name,
          start: iso(at(day, 13)),
          end: iso(at(day, 13.25)),
          kind: "meeting",
          title: "Daily stand-up",
        });
      }
      for (const info of [first, this.active, last]) {
        const startDay = info.startDay;
        const endDay = addWorkingDays(startDay, SPRINT_WORKING_DAYS - 1);
        this.calendar.push(
          {
            person: person.name,
            start: iso(at(startDay, 8)),
            end: iso(at(startDay, 9)),
            kind: "meeting",
            title: `${info.sprint.name} planning`,
          },
          {
            person: person.name,
            start: iso(at(endDay, 15.5)),
            end: iso(at(endDay, 17)),
            kind: "meeting",
            title: `${info.sprint.name} review and retro`,
          },
        );
      }
    }

    for (const pto of this.spec.pto) {
      const person = this.person(pto.person);
      for (const day of pto.days) {
        const date = this.activeDay(day);
        this.calendar.push({
          person: person.name,
          start: iso(date),
          end: iso(addDays(date, 1)),
          kind: "pto",
          title: "PTO",
        });
      }
    }

    this.calendar.sort(
      (a, b) =>
        Date.parse(a.start) - Date.parse(b.start) ||
        a.person.localeCompare(b.person) ||
        a.title.localeCompare(b.title),
    );
  }

  private buildDocs(): DocRef[] {
    return this.spec.docs.map((doc) => ({
      projectId: this.projectId,
      slug: doc.slug,
      title: doc.title,
      url: `${DEMO_DOCS_BASE_URL}/${doc.slug}`,
      updatedAt: iso(
        at(lastWorkingDayOnOrBefore(addDays(this.today, -doc.updatedDaysAgo)), 12),
      ),
      excerpt: doc.excerpt,
    }));
  }
}

/** Builds every record of one demo project, anchored to the UTC day of `now`. */
export function buildProjectRecords(spec: ProjectSpec, now: Date): ProjectRecords {
  return new ProjectGenerator(spec, now).build();
}
