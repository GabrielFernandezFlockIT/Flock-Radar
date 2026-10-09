import {
  SYNC_SOURCES,
  addDays,
  capacityFromEvents,
  startOfUtcDay,
  toIsoDate,
  type DateRange,
  type Project,
  type Sprint,
  type SyncRun,
  type SyncRunStats,
  type SyncSource,
} from "@/shared/domain";
import {
  RepositoryConstraintError,
  SourceUnavailableError,
  type Clock,
  type RadarRepository,
  type SourcePorts,
  type SyncRunOutcome,
} from "@/shared/ports";

/**
 * Sync use case: pulls every project's data from the source ports into the
 * repository and records one `SyncRun` per project and source.
 *
 * - Idempotent: everything is upserted on natural keys, so running it twice
 *   leaves the same data (only new sync runs are added).
 * - Defensive: batches are deduped by natural key (last occurrence wins) and
 *   rows pointing at records the source did not return are dropped and
 *   counted, because the repository rejects both (Postgres parity, D-032).
 * - Resilient: a failing source marks that project's run `failed` with a
 *   sanitized reason (never raw upstream text) and the other sources still
 *   sync. Runs that were started are always finished, even if the sync is
 *   interrupted by an unexpected error.
 * - Full sync since each project's start date. Incremental windows (using the
 *   last successful run) arrive with the live adapters in phase 9.
 */

export interface SyncProjectsDeps extends SourcePorts {
  repo: RadarRepository;
  clock: Clock;
}

export type SyncOutcomeStatus = "ok" | "partial" | "failed";

export interface SyncProjectsResult {
  /** `ok`: every run ok; `failed`: every run failed; otherwise `partial`. */
  status: SyncOutcomeStatus;
  startedAt: string;
  finishedAt: string;
  projects: number;
  /** One finished run per project and source (projects in name order, sources in `SYNC_SOURCES` order). */
  runs: SyncRun[];
}

/** Capacity always covers at least this many days from today. */
export const CAPACITY_LOOKAHEAD_DAYS = 14;

/**
 * Days for which capacity is derived: the whole active sprint (so elapsed
 * days can serve as a baseline) and at least `CAPACITY_LOOKAHEAD_DAYS` ahead.
 */
export function capacityWindow(activeSprint: Sprint | null, now: Date): DateRange {
  const today = startOfUtcDay(now);
  let start = today;
  let end = addDays(today, CAPACITY_LOOKAHEAD_DAYS);
  if (activeSprint) {
    const sprintStart = startOfUtcDay(new Date(activeSprint.startAt));
    const sprintEnd = startOfUtcDay(new Date(activeSprint.endAt));
    if (sprintStart < start) start = sprintStart;
    if (sprintEnd > end) end = sprintEnd;
  }
  return { start: toIsoDate(start), end: toIsoDate(end) };
}

/**
 * The only failure text ever stored on a sync run: the source plus a safe
 * reason. Unknown errors are reduced to their class name, so upstream bodies,
 * URLs, or tokens embedded in messages never reach the database or the UI.
 */
export function describeSyncFailure(source: SyncSource, error: unknown): string {
  if (error instanceof SourceUnavailableError) {
    const status = error.status === undefined ? "" : `HTTP ${error.status} `;
    return `${source}: ${status}${error.reason}`;
  }
  if (error instanceof RepositoryConstraintError) {
    return `${source}: rejected by the repository (${error.constraint})`;
  }
  const name = error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name)
    ? error.name
    : "error";
  return `${source}: unexpected ${name}`;
}

/** Keeps the last occurrence of every key, in first-seen key order. */
function dedupeBy<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) byKey.set(keyOf(item), item);
  return [...byKey.values()];
}

/** Adds non-zero counters only, so stats stay readable. */
function withCounters(
  stats: SyncRunStats,
  counters: Record<string, number>,
): SyncRunStats {
  const result = { ...stats };
  for (const [key, value] of Object.entries(counters)) {
    if (value > 0) result[key] = value;
  }
  return result;
}

interface StepContext {
  now: Date;
  /** Whether the issue tracker step failed for this project in this sync. */
  issueTrackerFailed: boolean;
}

type SourceStep = (project: Project, context: StepContext) => Promise<SyncRunStats>;

function buildSteps(deps: SyncProjectsDeps): Record<SyncSource, SourceStep> {
  const { repo, issueTracker, codeHost, calendar, docs } = deps;

  return {
    jira: async (project) => {
      // Fetch everything first so an outage never leaves a half-written sync.
      const fetchedSprints = await issueTracker.getSprints(project);
      const fetchedIssues = await issueTracker.getIssues(project);
      const sprints = dedupeBy(fetchedSprints, (sprint) => sprint.externalId);
      const deduped = dedupeBy(fetchedIssues, (issue) => issue.key);

      const knownSprintIds = new Set([
        ...sprints.map((sprint) => sprint.id),
        ...(await repo.sprints.byProject(project.id)).map((sprint) => sprint.id),
      ]);
      let unknownSprints = 0;
      const issues = deduped.map((issue) => {
        if (issue.sprintId === null || knownSprintIds.has(issue.sprintId)) return issue;
        unknownSprints += 1;
        return { ...issue, sprintId: null };
      });

      const keys = new Set(issues.map((issue) => issue.key));
      const [fetchedEvents, fetchedComments, fetchedWorklogs] = await Promise.all([
        issueTracker.getIssueEvents(project, [...keys]),
        issueTracker.getComments(project, [...keys]),
        issueTracker.getWorklogs(project, [...keys]),
      ]);
      const events = dedupeBy(fetchedEvents, (event) => event.externalId);
      const comments = dedupeBy(fetchedComments, (comment) => comment.id);
      const worklogs = dedupeBy(fetchedWorklogs, (worklog) => worklog.id);
      const linked = <T extends { issueKey: string }>(rows: T[]) =>
        rows.filter((row) => keys.has(row.issueKey));
      const keptEvents = linked(events);
      const keptComments = linked(comments);
      const keptWorklogs = linked(worklogs);

      // Parents before children (sprints -> issues -> events, comments, worklogs).
      await repo.sprints.upsertMany(sprints);
      await repo.issues.upsertMany(issues);
      await repo.issueEvents.upsertMany(keptEvents);
      await repo.issueComments.upsertMany(keptComments);
      await repo.worklogs.upsertMany(keptWorklogs);

      return withCounters(
        {
          sprints: sprints.length,
          issues: issues.length,
          issueEvents: keptEvents.length,
          issueComments: keptComments.length,
          worklogs: keptWorklogs.length,
        },
        {
          duplicatesDropped:
            fetchedSprints.length - sprints.length +
            fetchedIssues.length - deduped.length +
            fetchedEvents.length - events.length +
            fetchedComments.length - comments.length +
            fetchedWorklogs.length - worklogs.length,
          orphansDropped:
            events.length - keptEvents.length +
            comments.length - keptComments.length +
            worklogs.length - keptWorklogs.length,
          issuesWithUnknownSprint: unknownSprints,
        },
      );
    },

    github: async (project) => {
      const since = `${project.startDate}T00:00:00.000Z`;
      const [fetchedPullRequests, fetchedCommits] = await Promise.all([
        codeHost.getPullRequests(project, { since }),
        codeHost.getCommits(project, { since }),
      ]);
      const pullRequests = dedupeBy(fetchedPullRequests, (pr) => String(pr.number));
      const commits = dedupeBy(fetchedCommits, (commit) => commit.sha);
      await repo.pullRequests.upsertMany(pullRequests);
      await repo.commits.upsertMany(commits);
      return withCounters(
        { pullRequests: pullRequests.length, commits: commits.length },
        {
          duplicatesDropped:
            fetchedPullRequests.length - pullRequests.length +
            fetchedCommits.length - commits.length,
        },
      );
    },

    docs: async (project) => {
      const fetched = await docs.listDocs(project);
      const documents = dedupeBy(fetched, (doc) => doc.slug);
      await repo.docs.upsertMany(documents);
      return withCounters(
        { docs: documents.length },
        { duplicatesDropped: fetched.length - documents.length },
      );
    },

    // Runs after jira: the roster and the active sprint come from the repository.
    calendar: async (project, { now, issueTrackerFailed }) => {
      const issues = await repo.issues.byProject(project.id);
      const people = [
        ...new Set(
          issues
            .map((issue) => issue.assignee)
            .filter((assignee): assignee is string => assignee !== null),
        ),
      ].sort((a, b) => a.localeCompare(b));
      if (people.length === 0 && issueTrackerFailed) {
        throw new SourceUnavailableError(
          "calendar",
          "skipped: no team roster because the issue tracker sync failed",
        );
      }
      const range = capacityWindow(await repo.sprints.active(project.id, now), now);
      const events = await calendar.getEvents(people, range);
      const entries = capacityFromEvents(events, people, range).map((entry) => ({
        projectId: project.id,
        ...entry,
      }));
      await repo.capacity.upsertMany(entries);
      return {
        people: people.length,
        calendarEvents: events.length,
        capacityDays: entries.length,
      };
    },
  };
}

/** Order matters: calendar depends on what jira just stored. */
const STEP_ORDER: readonly SyncSource[] = ["jira", "github", "docs", "calendar"];

type PendingOutcome = Omit<SyncRunOutcome, "finishedAt">;

async function syncProject(
  project: Project,
  deps: SyncProjectsDeps,
  steps: Record<SyncSource, SourceStep>,
  now: Date,
  startedAt: string,
): Promise<SyncRun[]> {
  const { repo, clock } = deps;
  const started = new Map<SyncSource, SyncRun>();
  const outcomes = new Map<SyncSource, PendingOutcome>();
  let interruption: { error: unknown } | undefined;

  try {
    for (const source of SYNC_SOURCES) {
      started.set(
        source,
        await repo.syncRuns.start({ projectId: project.id, source, startedAt }),
      );
    }
    const context: StepContext = { now, issueTrackerFailed: false };
    for (const source of STEP_ORDER) {
      try {
        const stats = await steps[source](project, context);
        outcomes.set(source, { status: "ok", stats, error: null });
      } catch (error) {
        if (source === "jira") context.issueTrackerFailed = true;
        outcomes.set(source, {
          status: "failed",
          stats: {},
          error: describeSyncFailure(source, error),
        });
      }
    }
  } catch (error) {
    interruption = { error };
  }

  // Never leave a run "running": finish every started run, as failed when
  // the sync was interrupted before its step completed.
  const finished: SyncRun[] = [];
  for (const source of SYNC_SOURCES) {
    const run = started.get(source);
    if (!run) continue;
    const outcome = outcomes.get(source) ?? {
      status: "failed",
      stats: {},
      error: `${source}: sync interrupted`,
    };
    try {
      finished.push(
        await repo.syncRuns.finish(run.id, {
          ...outcome,
          finishedAt: clock.now().toISOString(),
        }),
      );
    } catch (error) {
      interruption ??= { error };
    }
  }

  if (interruption) throw interruption.error;
  return finished;
}

export async function syncProjects(
  deps: SyncProjectsDeps,
): Promise<SyncProjectsResult> {
  const { repo, clock } = deps;
  const now = clock.now();
  const startedAt = now.toISOString();
  const projects = await repo.projects.list();
  const steps = buildSteps(deps);

  const runs: SyncRun[] = [];
  for (const project of projects) {
    runs.push(...(await syncProject(project, deps, steps, now, startedAt)));
  }

  const status: SyncOutcomeStatus = runs.every((run) => run.status === "ok")
    ? "ok"
    : runs.every((run) => run.status === "failed")
      ? "failed"
      : "partial";

  return {
    status,
    startedAt,
    finishedAt: clock.now().toISOString(),
    projects: projects.length,
    runs,
  };
}
