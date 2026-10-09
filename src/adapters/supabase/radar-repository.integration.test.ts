import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  EMBEDDING_DIMENSIONS,
  type Issue,
  type MemoryItem,
  type Project,
} from "@/shared/domain";
import { AlertConflictError, type AlertDraft } from "@/shared/ports";

import { createServiceRoleClient } from "./client";
import { SupabaseRadarRepository } from "./radar-repository";

/**
 * Live integration test against a real Supabase project.
 *
 * SKIPPED (not failed) unless NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are set, so `npm test` stays green with no
 * credentials configured. When it runs it works inside ONE disposable project
 * and deletes it afterwards (every table cascades from `projects`).
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm test
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const configured = Boolean(url && serviceRoleKey);

const PROJECT_ID = "9f1b7a3e-0c4d-4f6a-8b21-5f0a1c2d3e40";
/** Unique per run: `jira_key` is unique across projects. */
const JIRA_KEY = `ZZ${Date.now().toString().slice(-7)}`;

const EVIDENCE = [
  {
    sourceType: "jira_issue" as const,
    externalId: `${JIRA_KEY}-1`,
    url: "https://example.atlassian.net/browse/TEST-1",
    occurredAt: "2026-10-01T10:00:00.000Z",
  },
];

const PROJECT: Project = {
  id: PROJECT_ID,
  name: "Integration fixture",
  jiraKey: JIRA_KEY,
  githubRepo: "flock/integration-fixture",
  clientName: "Internal",
  budgetAmount: 1000,
  budgetCurrency: "USD",
  hourlyRate: 50,
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  forecastUnit: "points",
  wipLimit: 3,
};

function issue(number: number, overrides: Partial<Issue> = {}): Issue {
  return {
    projectId: PROJECT_ID,
    key: `${JIRA_KEY}-${number}`,
    title: `Issue ${number}`,
    type: "Story",
    status: "To Do",
    statusCategory: "todo",
    points: null,
    assignee: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    resolvedAt: null,
    url: `https://example.atlassian.net/browse/${JIRA_KEY}-${number}`,
    sprintId: null,
    requiresCode: true,
    ...overrides,
  };
}

function draft(overrides: Partial<AlertDraft> = {}): AlertDraft {
  return {
    teamId: null,
    personId: null,
    severity: "high",
    confidence: 0.8,
    eta: "2026-10-20",
    title: "Scope grew",
    explanation: null,
    explanationSource: null,
    drivers: [],
    evidence: EVIDENCE,
    suggestedActions: [],
    detectedAt: "2026-10-02T10:00:00.000Z",
    ...overrides,
  };
}

/** A unit vector pointing at one dimension; cosine similarity is predictable. */
function unitVector(dimension: number): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vector[dimension] = 1;
  return vector;
}

function memoryItem(id: string, summary: string): MemoryItem {
  return {
    id,
    projectId: PROJECT_ID,
    kind: "decision",
    summary,
    evidence: EVIDENCE,
    occurredAt: "2026-10-01T10:00:00.000Z",
    status: "open",
  };
}

const MEMORY_NEAR = "9f1b7a3e-0c4d-4f6a-8b21-5f0a1c2d3e41";
const MEMORY_FAR = "9f1b7a3e-0c4d-4f6a-8b21-5f0a1c2d3e42";

describe.skipIf(!configured)("SupabaseRadarRepository (live)", () => {
  const client = configured
    ? createServiceRoleClient({ url: url ?? "", serviceRoleKey: serviceRoleKey ?? "" })
    : undefined;
  const repo = client ? new SupabaseRadarRepository(client) : undefined;

  const cleanup = async () => {
    await client?.from("projects").delete().eq("id", PROJECT_ID);
  };

  beforeAll(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
  });

  it("upserts a project and reads it back", async () => {
    const stored = await repo!.projects.upsert(PROJECT);
    expect(stored).toEqual(PROJECT);
    expect(await repo!.projects.get(PROJECT_ID)).toEqual(PROJECT);
  });

  it("upserts an issue batch idempotently and orders by key number", async () => {
    const batch = [issue(10), issue(2), issue(1)];

    await repo!.issues.upsertMany(batch);
    const first = await repo!.issues.byProject(PROJECT_ID);
    expect(first).toHaveLength(3);
    expect(first.map((item) => item.key)).toEqual([
      `${JIRA_KEY}-1`,
      `${JIRA_KEY}-2`,
      `${JIRA_KEY}-10`,
    ]);

    // Same data twice, plus a duplicate natural key inside the batch: the
    // second run updates in place and never duplicates rows.
    await repo!.issues.upsertMany([...batch, issue(2, { title: "Updated" })]);
    const second = await repo!.issues.byProject(PROJECT_ID);
    expect(second).toHaveLength(3);
    expect(second.find((item) => item.key === `${JIRA_KEY}-2`)?.title).toBe("Updated");
  });

  it("keeps the ack status and the first detection when the alert is re-detected", async () => {
    const created = await repo!.alerts.upsertForKind(PROJECT_ID, "scope_creep", draft());
    expect(created.status).toBe("open");

    const acked = await repo!.alerts.setStatus(created.id, "ack");
    expect(acked?.status).toBe("ack");

    const redetected = await repo!.alerts.upsertForKind(
      PROJECT_ID,
      "scope_creep",
      draft({ title: "Scope grew again", detectedAt: "2026-10-03T10:00:00.000Z" }),
    );
    expect(redetected.id).toBe(created.id);
    expect(redetected.status).toBe("ack");
    expect(redetected.createdAt).toBe(created.createdAt);
    expect(redetected.title).toBe("Scope grew again");
    expect(redetected.lastDetectedAt).toBe("2026-10-03T10:00:00.000Z");

    // Only one active alert of the kind exists, and reads are ordered.
    const active = await repo!.alerts.byProject(PROJECT_ID, "ack");
    expect(active.map((alert) => alert.id)).toEqual([created.id]);
  });

  it("throws AlertConflictError when reactivating would create a second active alert", async () => {
    const [first] = await repo!.alerts.byProject(PROJECT_ID, "ack");
    expect(first).toBeDefined();

    await repo!.alerts.setStatus(first.id, "resolved");
    // The slot is free, so the detector creates a NEW open alert.
    const second = await repo!.alerts.upsertForKind(PROJECT_ID, "scope_creep", draft());
    expect(second.id).not.toBe(first.id);

    await expect(repo!.alerts.setStatus(first.id, "open")).rejects.toBeInstanceOf(
      AlertConflictError,
    );
    expect(await repo!.alerts.setStatus("9f1b7a3e-0c4d-4f6a-8b21-5f0a1c2d3eff", "ack")).toBeNull();
  });

  it("round-trips memory items through match_memory_items", async () => {
    await repo!.memory.upsertMany([
      { ...memoryItem(MEMORY_NEAR, "Near item"), embedding: unitVector(0) },
      { ...memoryItem(MEMORY_FAR, "Far item"), embedding: unitVector(1) },
    ]);

    const hits = await repo!.memory.search(PROJECT_ID, unitVector(0), 5);
    expect(hits[0]?.item.id).toBe(MEMORY_NEAR);
    expect(hits[0]?.similarity).toBeCloseTo(1, 5);

    expect(await repo!.memory.search(PROJECT_ID, unitVector(0), 0)).toEqual([]);
    expect(
      await repo!.memory.search(PROJECT_ID, new Array(EMBEDDING_DIMENSIONS).fill(0), 5),
    ).toEqual([]);

    // A new summary without a new vector clears the stale embedding.
    await repo!.memory.upsertMany([memoryItem(MEMORY_NEAR, "Rewritten summary")]);
    const afterRewrite = await repo!.memory.search(PROJECT_ID, unitVector(0), 5);
    expect(afterRewrite.map((hit) => hit.item.id)).not.toContain(MEMORY_NEAR);

    // An unchanged summary keeps it.
    await repo!.memory.upsertMany([memoryItem(MEMORY_FAR, "Far item")]);
    const afterKeep = await repo!.memory.search(PROJECT_ID, unitVector(1), 5);
    expect(afterKeep.map((hit) => hit.item.id)).toContain(MEMORY_FAR);

    const listed = await repo!.memory.byProject(PROJECT_ID, { kind: "decision" });
    expect(listed.map((item) => item.id).sort()).toEqual([MEMORY_NEAR, MEMORY_FAR].sort());
  });
});
