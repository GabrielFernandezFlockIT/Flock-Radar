import type { RadarRepository, SourcePorts } from "@/shared/ports";

/**
 * Placeholder ports for live mode until the real adapters exist. Every method
 * rejects with a clear error, so `DEMO_MODE=false` boots (and the build stays
 * green) but any data access explains what is missing.
 */

export const LIVE_MODE_UNAVAILABLE_MESSAGE =
  "Live mode is not wired yet: the Supabase repository and the Jira, GitHub, Calendar, and Flocktools adapters land in phase 9. Run with DEMO_MODE=true until then.";

export class LiveModeUnavailableError extends Error {
  constructor(readonly operation: string) {
    super(`${LIVE_MODE_UNAVAILABLE_MESSAGE} (called ${operation})`);
    this.name = "LiveModeUnavailableError";
  }
}

type Shape<T> = { [Group in keyof T]: Record<keyof T[Group], true> };

// Exhaustive by type: adding a port method without listing it fails to compile.
const REPOSITORY_SHAPE: Shape<RadarRepository> = {
  projects: { list: true, get: true, upsert: true },
  sprints: { byProject: true, active: true, upsertMany: true },
  issues: { byProject: true, bySprint: true, upsertMany: true },
  issueEvents: { byProject: true, upsertMany: true },
  issueComments: { byProject: true, upsertMany: true },
  worklogs: { byProject: true, upsertMany: true },
  pullRequests: { byProject: true, upsertMany: true },
  commits: { byProject: true, upsertMany: true },
  capacity: { byProject: true, upsertMany: true },
  docs: { byProject: true, upsertMany: true },
  teams: { byProject: true, get: true, upsert: true, setActive: true },
  people: { list: true, get: true, upsertMany: true, search: true },
  teamMembers: { byTeam: true, byPerson: true, upsertMany: true, remove: true },
  statuses: {
    byTeam: true,
    byPerson: true,
    byProject: true,
    upsert: true,
    upsertMany: true,
    delete: true,
  },
  forecasts: { latest: true, insert: true },
  alerts: { byProject: true, upsertForKind: true, setStatus: true },
  memory: { byProject: true, upsertMany: true, search: true },
  reports: { byProject: true, get: true, insert: true },
  syncRuns: { start: true, finish: true, latestBySource: true },
  llmCalls: { insert: true, totals: true },
};

const SOURCES_SHAPE: Shape<SourcePorts> = {
  issueTracker: {
    getSprints: true,
    getIssues: true,
    getIssueEvents: true,
    getComments: true,
    getWorklogs: true,
  },
  codeHost: { getPullRequests: true, getCommits: true },
  calendar: { getEvents: true },
  docs: { listDocs: true },
};

function rejectingGroups(
  shape: Record<string, Record<string, true>>,
): Record<string, Record<string, () => Promise<never>>> {
  return Object.fromEntries(
    Object.entries(shape).map(([group, methods]) => [
      group,
      Object.fromEntries(
        Object.keys(methods).map((method) => [
          method,
          async () => {
            throw new LiveModeUnavailableError(`${group}.${method}`);
          },
        ]),
      ),
    ]),
  );
}

export function createUnavailableRepository(): RadarRepository {
  return rejectingGroups(REPOSITORY_SHAPE) as unknown as RadarRepository;
}

export function createUnavailableSources(): SourcePorts {
  return rejectingGroups(SOURCES_SHAPE) as unknown as SourcePorts;
}
