import { describe, expect, it } from "vitest";

import {
  buildMemory,
  getWeeklyDigest,
} from "@/modules/memory/application/build-memory";
import { PENDING_RULES } from "@/modules/memory/domain";
import { syncProjects } from "@/modules/ingestion/application/sync-projects";
import { EvidenceListSchema, type MemoryItem, type Project } from "@/shared/domain";
import type { Clock } from "@/shared/ports";

import { createDemoSources } from "./demo-sources";
import { InMemoryRadarRepository } from "./in-memory-radar-repository";
import { buildDemoDataset } from "./scenario/dataset";
import { DEMO_SCENARIO_EXPECTATIONS as EXPECT } from "./scenario/expectations";

/**
 * Integration: demo sources -> sync -> memory rules -> in-memory repository.
 * Lives with the adapters because application tests may not import adapters.
 *
 * It asserts that the five scripted pending items of `expectations.ts` are
 * detected, that every stored item carries evidence, and that a rerun upserts
 * instead of duplicating.
 */

const NOW = new Date(Date.UTC(2026, 9, 7, 12)); // Wednesday

async function boot(now: Date) {
  const clock: Clock = { now: () => now };
  const dataset = buildDemoDataset(now);
  const repo = new InMemoryRadarRepository({ ids: "deterministic", now: () => now });
  for (const project of dataset.projects) await repo.projects.upsert(project);
  await syncProjects({ repo, clock, ...createDemoSources(dataset) });
  const summary = await buildMemory({ repo, clock });
  const projects = await repo.projects.list();
  const byKey = (jiraKey: string) =>
    projects.find((project) => project.jiraKey === jiraKey) as Project;
  const itemsOf = async (jiraKey: string) => repo.memory.byProject(byKey(jiraKey).id);
  return { repo, clock, summary, byKey, itemsOf };
}

function pendingOf(items: readonly MemoryItem[], rule: { label: string }): MemoryItem[] {
  return items.filter(
    (item) => item.kind === "pending" && item.summary.startsWith(rule.label),
  );
}

describe("memory pipeline over the demo dataset", () => {
  it("detects the five scripted pending items", async () => {
    const { itemsOf } = await boot(NOW);
    const atlas = await itemsOf("ATL");
    const beacon = await itemsOf("BCN");
    const cobalt = await itemsOf("CBL");

    // ATL-308: a Jira question nobody answered for more than 48 h.
    const unanswered = pendingOf(atlas, PENDING_RULES.unansweredQuestion);
    expect(unanswered).toHaveLength(1);
    expect(unanswered[0].summary).toContain(EXPECT.atlas.unansweredQuestionIssueKey);

    // BCN-306: in progress, no linked commit for 5+ working days.
    const stalled = pendingOf(beacon, PENDING_RULES.stalledIssue);
    expect(stalled.map((item) => item.summary).join(" ")).toContain(
      EXPECT.beacon.stalledIssueKey,
    );

    // BCN-307: its PR has waited more than 48 h for a first review.
    const stuck = pendingOf(beacon, PENDING_RULES.prStuck);
    expect(stuck).toHaveLength(1);
    expect(stuck[0].evidence.map((entry) => entry.externalId)).toContain(
      EXPECT.beacon.staleReviewIssueKey,
    );
    expect(stuck[0].summary).toContain("esperando una primera revisión");

    // The orphan hotfix: merged with no issue reference.
    const orphan = pendingOf(beacon, PENDING_RULES.prWithoutClosedIssue);
    expect(orphan).toHaveLength(1);
    expect(orphan[0].summary).toContain(EXPECT.beacon.orphanMergedPrTitle);

    // CBL-302: Done, requires code, committed straight to main.
    const doneWithoutPr = pendingOf(cobalt, PENDING_RULES.doneWithoutPr);
    expect(doneWithoutPr).toHaveLength(1);
    expect(doneWithoutPr[0].summary).toContain(EXPECT.cobalt.doneWithoutMergedPrIssueKey);
  });

  it("gives every project a non-empty, fully evidenced memory set", async () => {
    const { summary, itemsOf } = await boot(NOW);
    expect(summary.projects.every((project) => project.error === null)).toBe(true);

    for (const jiraKey of ["ATL", "BCN", "CBL"]) {
      const items = await itemsOf(jiraKey);
      expect(items.length).toBeGreaterThan(0);
      expect(items.filter((item) => item.kind === "done").length).toBeGreaterThan(0);
      expect(items.filter((item) => item.kind === "pending").length).toBeGreaterThan(0);
      expect(items.filter((item) => item.kind === "decision").length).toBeGreaterThan(0);
      for (const item of items) {
        expect(() => EvidenceListSchema.parse(item.evidence)).not.toThrow();
      }
    }

    const cobalt = await itemsOf("CBL");
    expect(cobalt.filter((item) => item.kind === "decision")).toHaveLength(
      EXPECT.cobalt.decisionDocs,
    );
  });

  it("is idempotent across reruns on the same day", async () => {
    const { repo, clock, itemsOf } = await boot(NOW);
    const before = await itemsOf("BCN");
    await buildMemory({ repo, clock });
    await buildMemory({ repo, clock });
    const after = await itemsOf("BCN");
    expect(after).toEqual(before);
  });

  it("builds a weekly digest whose bullets all carry evidence", async () => {
    const { repo, byKey } = await boot(NOW);
    const digest = await getWeeklyDigest({ repo, projectId: byKey("BCN").id, now: NOW });
    expect(digest.done.length).toBeGreaterThan(0);
    expect(digest.pending.length).toBeGreaterThan(0);
    // Still open is still pending, even when it started before the window:
    // BCN-306's last commit is 7 working days old.
    expect(digest.pending.flatMap((group) => group.items.map((item) => item.summary)).join(" ")).toContain(
      EXPECT.beacon.stalledIssueKey,
    );
    const bullets = [
      ...digest.done,
      ...digest.pending.flatMap((group) => group.items),
      ...digest.decisions,
      ...digest.risks,
      ...digest.nextSteps,
    ];
    for (const bullet of bullets) {
      expect(bullet.evidence.length).toBeGreaterThan(0);
    }
    // The done items carry the full chain: issue -> PR -> merge commit.
    const chained = digest.done.find((item) => item.evidence.length === 3);
    expect(chained?.evidence.map((entry) => entry.sourceType)).toEqual([
      "jira_issue",
      "github_pr",
      "github_commit",
    ]);
  });
});
