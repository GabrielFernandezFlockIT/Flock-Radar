import { describe, expect, it } from "vitest";

import { syncProjects } from "@/modules/ingestion/application/sync-projects";
import type { Project } from "@/shared/domain";
import {
  SourceUnavailableError,
  type Clock,
  type RadarRepository,
  type SourcePorts,
} from "@/shared/ports";

import { DemoSourceUnavailableError, createDemoSources } from "./demo-sources";
import { InMemoryRadarRepository } from "./in-memory-radar-repository";
import { buildDemoDataset, type DemoDataset } from "./scenario/dataset";

/**
 * Integration: demo sources -> sync use case -> in-memory repository. Lives
 * with the adapters because application code (and its tests) may not import
 * adapters.
 */

const NOW = new Date("2026-10-08T07:00:00Z");
const clock: Clock = { now: () => NOW };

async function seededRepo(dataset: DemoDataset): Promise<InMemoryRadarRepository> {
  const repo = new InMemoryRadarRepository();
  for (const project of dataset.projects) await repo.projects.upsert(project);
  return repo;
}

async function snapshot(repo: RadarRepository) {
  const projects = await repo.projects.list();
  const counts: Record<string, number> = {};
  for (const project of projects) {
    const groups = {
      sprints: await repo.sprints.byProject(project.id),
      issues: await repo.issues.byProject(project.id),
      issueEvents: await repo.issueEvents.byProject(project.id),
      issueComments: await repo.issueComments.byProject(project.id),
      worklogs: await repo.worklogs.byProject(project.id),
      pullRequests: await repo.pullRequests.byProject(project.id),
      commits: await repo.commits.byProject(project.id),
      capacity: await repo.capacity.byProject(project.id),
      docs: await repo.docs.byProject(project.id),
    };
    for (const [group, rows] of Object.entries(groups)) {
      counts[group] = (counts[group] ?? 0) + rows.length;
    }
  }
  return counts;
}

function byKey(dataset: DemoDataset, jiraKey: string): Project {
  const project = dataset.projects.find((item) => item.jiraKey === jiraKey);
  if (!project) throw new Error(`missing ${jiraKey}`);
  return project;
}

describe("syncProjects with demo sources", () => {
  const dataset = buildDemoDataset(NOW);
  const beacon = byKey(dataset, "BCN");

  it("loads every source record and records one run per project and source", async () => {
    const repo = await seededRepo(dataset);
    const result = await syncProjects({ repo, clock, ...createDemoSources(dataset) });

    expect(result.status).toBe("ok");
    expect(result.projects).toBe(3);
    expect(result.runs).toHaveLength(12);
    expect(result.runs.every((run) => run.status === "ok" && run.error === null)).toBe(true);

    const counts = await snapshot(repo);
    expect(counts).toMatchObject({
      sprints: dataset.sprints.length,
      issues: dataset.issues.length,
      issueEvents: dataset.issueEvents.length,
      issueComments: dataset.issueComments.length,
      worklogs: dataset.worklogs.length,
      pullRequests: dataset.pullRequests.length,
      commits: dataset.commits.length,
      docs: dataset.docs.length,
    });
    expect(counts.capacity).toBeGreaterThan(0);

    const runs = await repo.syncRuns.latestBySource(beacon.id);
    expect(runs.map((run) => [run.source, run.status])).toEqual([
      ["jira", "ok"],
      ["github", "ok"],
      ["calendar", "ok"],
      ["docs", "ok"],
    ]);
    expect(runs.every((run) => run.projectId === beacon.id)).toBe(true);
    expect(runs.find((run) => run.source === "jira")?.stats).toEqual({
      sprints: dataset.sprints.filter((item) => item.projectId === beacon.id).length,
      issues: dataset.issues.filter((item) => item.projectId === beacon.id).length,
      issueEvents: dataset.issueEvents.filter((item) => item.projectId === beacon.id).length,
      issueComments: dataset.issueComments.filter((item) => item.projectId === beacon.id).length,
      worklogs: dataset.worklogs.filter((item) => item.projectId === beacon.id).length,
    });
  });

  it("is idempotent: a second sync adds runs but no duplicate data", async () => {
    const repo = await seededRepo(dataset);
    const sources = createDemoSources(dataset);

    await syncProjects({ repo, clock, ...sources });
    const first = await snapshot(repo);
    await syncProjects({ repo, clock, ...sources });

    expect(await snapshot(repo)).toEqual(first);
  });

  it("derives capacity from the calendar, including Beacon's PTO", async () => {
    const repo = await seededRepo(dataset);
    await syncProjects({ repo, clock, ...createDemoSources(dataset) });

    const capacity = await repo.capacity.byProject(beacon.id);
    const ptoDays = capacity.filter((entry) => entry.reason === "pto");
    expect(new Set(ptoDays.map((entry) => entry.person))).toEqual(
      new Set(["Camila Ortega", "Nicolás Vega"]),
    );
    expect(ptoDays.every((entry) => entry.availableHours === 0)).toBe(true);
  });

  it("keeps syncing other sources when one is down, with a sanitized reason", async () => {
    const repo = await seededRepo(dataset);
    const result = await syncProjects({
      repo,
      clock,
      ...createDemoSources(dataset, { failSource: "github" }),
    });

    expect(result.status).toBe("partial");
    const github = result.runs.filter((run) => run.source === "github");
    expect(github).toHaveLength(3);
    for (const run of github) {
      expect(run).toMatchObject({
        status: "failed",
        error: "github: HTTP 503 simulated outage",
        stats: {},
      });
    }
    expect(
      result.runs.filter((run) => run.source !== "github").every((run) => run.status === "ok"),
    ).toBe(true);

    const counts = await snapshot(repo);
    expect(counts.pullRequests).toBe(0);
    expect(counts.commits).toBe(0);
    expect(counts.issues).toBe(dataset.issues.length);
  });

  it("isolates failures per project and never stores raw upstream text", async () => {
    const repo = await seededRepo(dataset);
    const sources = createDemoSources(dataset);
    const flaky: SourcePorts = {
      ...sources,
      docs: {
        listDocs: async (project) => {
          if (project.jiraKey === "CBL") {
            throw new Error(
              "Flocktools 500 at https://flocktools.example/api?token=s3cret: <html>stack</html>",
            );
          }
          if (project.jiraKey === "ATL") {
            throw new SourceUnavailableError(
              "docs",
              "rate limited, retry after https://flocktools.example/limits",
              { status: 429 },
            );
          }
          return sources.docs.listDocs(project);
        },
      },
    };

    const result = await syncProjects({ repo, clock, ...flaky });

    expect(result.status).toBe("partial");
    const docsRuns = Object.fromEntries(
      result.runs
        .filter((run) => run.source === "docs")
        .map((run) => [
          dataset.projects.find((project) => project.id === run.projectId)?.jiraKey,
          [run.status, run.error],
        ]),
    );
    expect(docsRuns).toEqual({
      ATL: ["failed", "docs: HTTP 429 rate limited, retry after [url]"],
      BCN: ["ok", null],
      CBL: ["failed", "docs: unexpected Error"],
    });
    expect(JSON.stringify(result.runs)).not.toMatch(/s3cret|flocktools\.example|<html>/);
  });

  it("fails the calendar run with a clear reason when there is no roster", async () => {
    const repo = await seededRepo(dataset);
    const result = await syncProjects({
      repo,
      clock,
      ...createDemoSources(dataset, { failSource: "jira" }),
    });

    const calendar = result.runs.filter((run) => run.source === "calendar");
    expect(calendar.map((run) => [run.status, run.error])).toEqual(
      Array(3).fill([
        "failed",
        "calendar: skipped: no team roster because the issue tracker sync failed",
      ]),
    );
    expect(result.status).toBe("partial");
  });

  it("reports failed when every source is down, and recovers on the next sync", async () => {
    const repo = await seededRepo(dataset);
    const down = await syncProjects({
      repo,
      clock,
      ...createDemoSources(dataset, { failSource: ["jira", "github", "calendar", "docs"] }),
    });
    expect(down.status).toBe("failed");

    const recovered = await syncProjects({ repo, clock, ...createDemoSources(dataset) });
    expect(recovered.status).toBe("ok");
    expect((await snapshot(repo)).issues).toBe(dataset.issues.length);
    expect((await repo.syncRuns.latestBySource(beacon.id)).every((run) => run.status === "ok")).toBe(true);
  });

  it("finishes started runs as failed when the sync is interrupted", async () => {
    const repo = await seededRepo(dataset);
    const failing: RadarRepository = {
      ...repo,
      syncRuns: {
        ...repo.syncRuns,
        start: async (input) => {
          if (input.source === "calendar") throw new Error("database went away");
          return repo.syncRuns.start(input);
        },
      },
    };

    await expect(
      syncProjects({ repo: failing, clock, ...createDemoSources(dataset) }),
    ).rejects.toThrow("database went away");

    const [first] = await repo.projects.list();
    const runs = await repo.syncRuns.latestBySource(first.id);
    expect(runs.map((run) => [run.source, run.status, run.error])).toEqual([
      ["jira", "failed", "jira: sync interrupted"],
      ["github", "failed", "github: sync interrupted"],
    ]);
  });

  it("dedupes batches (last wins) and drops rows pointing at unknown records", async () => {
    const repo = await seededRepo(dataset);
    const sources = createDemoSources(dataset);
    const [firstSprint] = dataset.sprints.filter((sprint) => sprint.projectId === beacon.id);
    const noisy: SourcePorts = {
      ...sources,
      issueTracker: {
        ...sources.issueTracker,
        getSprints: async (project) => {
          const sprints = await sources.issueTracker.getSprints(project);
          return project.id === beacon.id ? [...sprints, firstSprint] : sprints;
        },
        getIssues: async (project) => {
          const issues = await sources.issueTracker.getIssues(project);
          if (project.id !== beacon.id) return issues;
          const [first] = issues;
          return [
            ...issues,
            { ...first, title: "Retitled in a later page" },
            {
              ...first,
              key: "BCN-999",
              sprintId: "00000000-0000-4000-8000-00000000dead",
            },
          ];
        },
        getIssueEvents: async (project, keys) => {
          const events = await sources.issueTracker.getIssueEvents(project, keys);
          if (project.id !== beacon.id) return events;
          return [...events, { ...events[0], externalId: "orphan#1", issueKey: "BCN-4242" }];
        },
      },
    };

    const result = await syncProjects({ repo, clock, ...noisy });

    expect(result.status).toBe("ok");
    const jira = result.runs.find(
      (run) => run.projectId === beacon.id && run.source === "jira",
    );
    expect(jira?.stats).toMatchObject({
      duplicatesDropped: 2,
      orphansDropped: 1,
      issuesWithUnknownSprint: 1,
    });
    const issues = await repo.issues.byProject(beacon.id);
    const [first] = dataset.issues.filter((issue) => issue.projectId === beacon.id);
    expect(issues.find((issue) => issue.key === first.key)?.title).toBe(
      "Retitled in a later page",
    );
    expect(issues.find((issue) => issue.key === "BCN-999")?.sprintId).toBeNull();
  });
});

describe("createDemoSources", () => {
  const dataset = buildDemoDataset(NOW);
  const [project] = dataset.projects;

  it("rejects calls to a failing source with a typed, sanitized error", async () => {
    const sources = createDemoSources(dataset, { failSource: "jira" });
    const failure = sources.issueTracker.getIssues(project);
    await expect(failure).rejects.toBeInstanceOf(DemoSourceUnavailableError);
    await expect(failure).rejects.toBeInstanceOf(SourceUnavailableError);
    await expect(sources.docs.listDocs(project)).resolves.not.toHaveLength(0);
  });

  it("returns copies that cannot mutate the dataset", async () => {
    const sources = createDemoSources(dataset);
    const [issue] = await sources.issueTracker.getIssues(project);
    issue.title = "mutated";
    const [again] = await sources.issueTracker.getIssues(project);
    expect(again.title).not.toBe("mutated");
  });

  it("filters by update time, issue keys, and date range", async () => {
    const sources = createDemoSources(dataset);
    const all = await sources.issueTracker.getIssues(project);
    const recent = await sources.issueTracker.getIssues(project, {
      updatedSince: "2026-10-01T00:00:00.000Z",
    });
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.length).toBeLessThan(all.length);

    const [first] = all;
    const events = await sources.issueTracker.getIssueEvents(project, [first.key]);
    expect(events.every((event) => event.issueKey === first.key)).toBe(true);

    const calendar = await sources.calendar.getEvents(["Lucía Fernández"], {
      start: "2026-10-08",
      end: "2026-10-08",
    });
    expect(calendar.length).toBeGreaterThan(0);
    expect(calendar.every((event) => event.person === "Lucía Fernández")).toBe(true);
    expect(
      calendar.every(
        (event) =>
          event.start < "2026-10-09T00:00:00.000Z" && event.end > "2026-10-08T00:00:00.000Z",
      ),
    ).toBe(true);
  });
});
