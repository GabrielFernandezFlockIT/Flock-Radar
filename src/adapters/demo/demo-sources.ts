import {
  fromIsoDate,
  addDays,
  type Project,
  type SyncSource,
} from "@/shared/domain";
import {
  SourceUnavailableError,
  type CalendarSource,
  type CodeHost,
  type DocsSource,
  type IssueTracker,
  type SourcePorts,
} from "@/shared/ports";

import type { DemoDataset } from "./scenario/dataset";

/**
 * Demo implementations of every source port, served from a `DemoDataset`.
 * Results are deep copies, so callers can never mutate the dataset.
 *
 * `failSource` simulates an outage: every call to that source rejects with a
 * `DemoSourceUnavailableError`, which lets tests (and demos) exercise the
 * partial-sync path.
 */

export interface DemoSourcesOptions {
  failSource?: SyncSource | readonly SyncSource[];
}

export class DemoSourceUnavailableError extends SourceUnavailableError {
  constructor(source: SyncSource) {
    super(source, "simulated outage", { status: 503 });
    this.name = "DemoSourceUnavailableError";
  }
}

function forProject<T extends { projectId: string }>(
  items: readonly T[],
  project: Project,
): T[] {
  return structuredClone(items.filter((item) => item.projectId === project.id));
}

function atOrAfter(timestamp: string | null, since: number): boolean {
  return timestamp !== null && Date.parse(timestamp) >= since;
}

export function createDemoSources(
  dataset: DemoDataset,
  options: DemoSourcesOptions = {},
): SourcePorts {
  const failing = new Set<SyncSource>(
    options.failSource === undefined
      ? []
      : typeof options.failSource === "string"
        ? [options.failSource]
        : options.failSource,
  );
  const ensureAvailable = (source: SyncSource) => {
    if (failing.has(source)) throw new DemoSourceUnavailableError(source);
  };

  const issueTracker: IssueTracker = {
    async getSprints(project) {
      ensureAvailable("jira");
      return forProject(dataset.sprints, project);
    },
    async getIssues(project, query = {}) {
      ensureAvailable("jira");
      const issues = forProject(dataset.issues, project);
      if (!query.updatedSince) return issues;
      const since = Date.parse(query.updatedSince);
      return issues.filter((issue) => atOrAfter(issue.updatedAt, since));
    },
    async getIssueEvents(project, issueKeys) {
      ensureAvailable("jira");
      const keys = new Set(issueKeys);
      return forProject(dataset.issueEvents, project).filter((event) =>
        keys.has(event.issueKey),
      );
    },
    async getComments(project, issueKeys) {
      ensureAvailable("jira");
      const keys = new Set(issueKeys);
      return forProject(dataset.issueComments, project).filter((comment) =>
        keys.has(comment.issueKey),
      );
    },
    async getWorklogs(project, issueKeys) {
      ensureAvailable("jira");
      const keys = new Set(issueKeys);
      return forProject(dataset.worklogs, project).filter((worklog) =>
        keys.has(worklog.issueKey),
      );
    },
  };

  const codeHost: CodeHost = {
    async getPullRequests(project, { since }) {
      ensureAvailable("github");
      const from = Date.parse(since);
      return forProject(dataset.pullRequests, project).filter(
        (pr) =>
          atOrAfter(pr.createdAt, from) ||
          atOrAfter(pr.firstReviewAt, from) ||
          atOrAfter(pr.mergedAt, from),
      );
    },
    async getCommits(project, { since }) {
      ensureAvailable("github");
      const from = Date.parse(since);
      return forProject(dataset.commits, project).filter((commit) =>
        atOrAfter(commit.committedAt, from),
      );
    },
  };

  const calendar: CalendarSource = {
    async getEvents(people, range) {
      ensureAvailable("calendar");
      const roster = new Set(people);
      const start = fromIsoDate(range.start).getTime();
      const end = addDays(fromIsoDate(range.end), 1).getTime();
      return structuredClone(
        dataset.calendarEvents.filter(
          (event) =>
            roster.has(event.person) &&
            Date.parse(event.start) < end &&
            Date.parse(event.end) > start,
        ),
      );
    },
  };

  const docs: DocsSource = {
    async listDocs(project) {
      ensureAvailable("docs");
      return forProject(dataset.docs, project);
    },
  };

  return { issueTracker, codeHost, calendar, docs };
}
