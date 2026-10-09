import { describe, expect, it } from "vitest";

import type {
  Alert,
  Commit,
  Issue,
  IssueEvent,
  MemoryItem,
  Person,
  Project,
  PullRequest,
  Sprint,
  Status,
  Team,
  TeamMember,
} from "@/shared/domain";
import { RepositoryConstraintError } from "@/shared/ports";

import {
  fromAlertRow,
  fromCapacityRow,
  fromCommitRow,
  fromForecastRow,
  fromIssueEventRow,
  fromIssueRow,
  fromLlmCallRow,
  fromMemoryItemRow,
  fromPersonRow,
  fromProjectRow,
  fromPullRequestRow,
  fromReportRow,
  fromSprintRow,
  fromStatusRow,
  fromSyncRunRow,
  fromTeamMemberRow,
  fromTeamRow,
  requireIssueId,
  toCommitRow,
  toIssueEventRow,
  toIssueRow,
  toMemoryItemRow,
  toPersonRow,
  toProjectRow,
  toPullRequestRow,
  toSprintRow,
  toStatusRow,
  toTeamMemberRow,
  toTeamRow,
  toVectorLiteral,
} from "./mappers";

/**
 * Row mapping is pure: no client, no network. These tests pin the shapes that
 * are easy to get wrong — instants, nullable vs. optional fields, numerics
 * that may arrive as strings, text arrays, and jsonb documents.
 */

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SPRINT_ID = "22222222-2222-4222-8222-222222222222";
const ALERT_ID = "33333333-3333-4333-8333-333333333333";
const MEMORY_ID = "44444444-4444-4444-8444-444444444444";
const ISSUE_ROW_ID = "55555555-5555-4555-8555-555555555555";
const SHA = "a".repeat(40);

const EVIDENCE = [
  {
    sourceType: "jira_issue" as const,
    externalId: "BCN-1",
    url: "https://demo.atlassian.net/browse/BCN-1",
    occurredAt: "2026-10-01T10:00:00.000Z",
  },
];

describe("project mapping", () => {
  const project: Project = {
    id: PROJECT_ID,
    name: "Beacon",
    jiraKey: "BCN",
    githubRepo: "flock/beacon",
    clientName: "Acme",
    budgetAmount: 120_000,
    budgetCurrency: "USD",
    hourlyRate: 85,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    forecastUnit: "points",
    wipLimit: 5,
    boardId: "42",
  };

  it("round-trips a project with a board", () => {
    expect(fromProjectRow(toProjectRow(project))).toEqual(project);
  });

  it("treats a null board_id as an absent key, not null", () => {
    const withoutBoard: Project = { ...project };
    delete withoutBoard.boardId;
    const row = toProjectRow(withoutBoard);

    expect(row.board_id).toBeNull();
    const parsed = fromProjectRow(row);
    expect("boardId" in parsed).toBe(false);
    expect(parsed).toEqual(withoutBoard);
  });

  it("accepts numerics rendered as strings", () => {
    const parsed = fromProjectRow({
      ...toProjectRow(project),
      budget_amount: "120000.00",
      hourly_rate: "85.00",
    });
    expect(parsed.budgetAmount).toBe(120_000);
    expect(parsed.hourlyRate).toBe(85);
  });

  it("fails loudly on a row that violates the domain schema", () => {
    expect(() => fromProjectRow({ ...toProjectRow(project), jira_key: "lower" })).toThrow();
    expect(() => fromProjectRow("not a row")).toThrow(/projects/);
  });
});

describe("sprint mapping", () => {
  const sprint: Sprint = {
    id: SPRINT_ID,
    projectId: PROJECT_ID,
    externalId: "jira-7",
    name: "Sprint 7",
    goal: null,
    startAt: "2026-10-01T00:00:00.000Z",
    endAt: "2026-10-15T00:00:00.000Z",
    state: "active",
    committedPoints: null,
  };

  it("round-trips nullable goal and committed points", () => {
    expect(fromSprintRow(toSprintRow(sprint))).toEqual(sprint);
  });

  it("normalizes an offset timestamp to UTC", () => {
    const parsed = fromSprintRow({
      ...toSprintRow(sprint),
      start_at: "2026-10-01T02:00:00+02:00",
    });
    expect(parsed.startAt).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("issue mapping", () => {
  const issue: Issue = {
    projectId: PROJECT_ID,
    key: "BCN-12",
    title: "Ship the radar",
    type: "Story",
    status: "In Progress",
    statusCategory: "in_progress",
    points: null,
    assignee: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-02T10:00:00.000Z",
    resolvedAt: null,
    url: "https://demo.atlassian.net/browse/BCN-12",
    sprintId: null,
    requiresCode: true,
  };

  it("round-trips nullable points, assignee, sprint, and resolution", () => {
    expect(fromIssueRow(toIssueRow(issue))).toEqual(issue);
  });

  it("never sends the database-assigned uuid", () => {
    expect(toIssueRow(issue)).not.toHaveProperty("id");
  });

  it("round-trips a sprint link and a decimal estimate", () => {
    const linked: Issue = {
      ...issue,
      sprintId: SPRINT_ID,
      points: 3.5,
      assignee: "ana",
      resolvedAt: "2026-10-03T10:00:00.000Z",
    };
    expect(fromIssueRow(toIssueRow(linked))).toEqual(linked);
  });
});

describe("issue event mapping", () => {
  const event: IssueEvent = {
    projectId: PROJECT_ID,
    externalId: "changelog-1",
    issueKey: "BCN-12",
    field: "status",
    from: "To Do",
    to: "In Progress",
    at: "2026-10-02T10:00:00.000Z",
    author: null,
  };

  it("maps from/to onto the reserved-word columns and back through the key map", () => {
    const row = toIssueEventRow(event, ISSUE_ROW_ID);
    expect(row).toMatchObject({
      issue_id: ISSUE_ROW_ID,
      from_value: "To Do",
      to_value: "In Progress",
    });
    expect(fromIssueEventRow(row, new Map([[ISSUE_ROW_ID, "BCN-12"]]))).toEqual(event);
  });

  it("rejects a write whose issue is not in the project, like the composite FK", () => {
    expect(() =>
      requireIssueId("issue_events", new Map(), PROJECT_ID, "BCN-99"),
    ).toThrow(RepositoryConstraintError);
  });

  it("fails on a read whose issue was not read back", () => {
    expect(() =>
      fromIssueEventRow(toIssueEventRow(event, ISSUE_ROW_ID), new Map()),
    ).toThrow(/issue_events/);
  });
});

describe("code host mapping", () => {
  const pullRequest: PullRequest = {
    projectId: PROJECT_ID,
    number: 42,
    title: "Add the radar",
    state: "merged",
    author: "ana",
    createdAt: "2026-10-01T10:00:00.000Z",
    mergedAt: "2026-10-02T10:00:00.000Z",
    firstReviewAt: null,
    linkedIssueKeys: ["BCN-12", "BCN-13"],
    url: "https://github.com/flock/beacon/pull/42",
    headSha: SHA,
    mergeCommitSha: "b".repeat(40),
  };

  it("round-trips linked issue keys and both SHAs", () => {
    expect(fromPullRequestRow(toPullRequestRow(pullRequest))).toEqual(pullRequest);
  });

  it("drops absent SHAs instead of storing null in the domain", () => {
    const bare: PullRequest = { ...pullRequest };
    delete bare.headSha;
    delete bare.mergeCommitSha;
    const parsed = fromPullRequestRow(toPullRequestRow(bare));
    expect("headSha" in parsed).toBe(false);
    expect("mergeCommitSha" in parsed).toBe(false);
    expect(parsed.linkedIssueKeys).toEqual(["BCN-12", "BCN-13"]);
  });

  it("round-trips a commit with an empty linked-key array", () => {
    const commit: Commit = {
      projectId: PROJECT_ID,
      sha: SHA,
      author: "ana",
      message: "",
      committedAt: "2026-10-01T10:00:00.000Z",
      linkedIssueKeys: [],
      url: `https://github.com/flock/beacon/commit/${SHA}`,
    };
    expect(fromCommitRow(toCommitRow(commit))).toEqual(commit);
  });
});

describe("team, person, membership, and status mapping", () => {
  const TEAM_ID = "0b6f3f2e-1c1d-5e4a-8b7c-000000000001";
  const PERSON_ID = "0b6f3f2e-1c1d-5e4a-8b7c-00000000000a";
  const INSTANT = "2026-01-05T09:00:00.000Z";

  it("round-trips a team without a description", () => {
    const team: Team = {
      id: TEAM_ID,
      projectId: PROJECT_ID,
      name: "Beacon",
      description: null,
      active: true,
      createdAt: INSTANT,
      updatedAt: INSTANT,
    };
    expect(fromTeamRow(toTeamRow(team))).toEqual(team);
  });

  it("round-trips a person without an email", () => {
    const person: Person = {
      id: PERSON_ID,
      fullName: "Nicolás Vega",
      email: null,
      active: true,
      createdAt: INSTANT,
      updatedAt: INSTANT,
    };
    expect(fromPersonRow(toPersonRow(person))).toEqual(person);
  });

  it("round-trips a current membership", () => {
    const member: TeamMember = {
      id: "0b6f3f2e-1c1d-5e4a-8b7c-00000000001a",
      teamId: TEAM_ID,
      personId: PERSON_ID,
      role: "business_translator",
      startedOn: "2026-01-05",
      endedOn: null,
    };
    expect(fromTeamMemberRow(toTeamMemberRow(member))).toEqual(member);
  });

  it("round-trips a status with blockers and an author who is someone else", () => {
    const status: Status = {
      id: "0b6f3f2e-1c1d-5e4a-8b7c-00000000002a",
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      personId: PERSON_ID,
      reportedOn: "2026-10-08",
      summary: "Avancé con las cotizaciones del carrier.",
      blockers: "Faltan las credenciales del sandbox.",
      nextSteps: null,
      authorPersonId: "0b6f3f2e-1c1d-5e4a-8b7c-00000000000b",
      source: "manual",
      createdAt: "2026-10-08T17:30:00.000Z",
      updatedAt: "2026-10-08T17:30:00.000Z",
    };
    expect(fromStatusRow(toStatusRow(status))).toEqual(status);
  });
});

describe("alert mapping", () => {
  const alert: Alert = {
    id: ALERT_ID,
    projectId: PROJECT_ID,
    teamId: null,
    personId: null,
    kind: "scope_creep",
    severity: "high",
    confidence: 0.82,
    eta: "2026-10-20",
    title: "Scope grew 22%",
    explanation: null,
    explanationSource: null,
    drivers: [{ key: "added", label: "Scope added", value: 13, unit: "pts" }],
    evidence: EVIDENCE,
    suggestedActions: [{ title: "Re-plan", rationale: "The sprint cannot absorb it" }],
    status: "ack",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-02T10:00:00.000Z",
    lastDetectedAt: "2026-10-02T10:00:00.000Z",
  };

  it("reads jsonb drivers, evidence, and actions back as domain objects", () => {
    const row = {
      id: alert.id,
      project_id: alert.projectId,
      kind: alert.kind,
      severity: alert.severity,
      confidence: "0.820",
      eta: alert.eta,
      title: alert.title,
      explanation: null,
      explanation_source: null,
      drivers: alert.drivers,
      evidence: alert.evidence,
      suggested_actions: alert.suggestedActions,
      status: alert.status,
      created_at: "2026-10-01T10:00:00+00:00",
      updated_at: "2026-10-02T10:00:00+00:00",
      last_detected_at: "2026-10-02T10:00:00+00:00",
    };
    expect(fromAlertRow(row)).toEqual(alert);
  });

  it("rejects an alert row without evidence", () => {
    expect(() =>
      fromAlertRow({
        ...{
          id: alert.id,
          project_id: alert.projectId,
          kind: alert.kind,
          severity: alert.severity,
          confidence: 0.5,
          eta: null,
          title: alert.title,
          explanation: null,
          explanation_source: null,
          drivers: [],
          suggested_actions: [],
          status: "open",
          created_at: alert.createdAt,
          updated_at: alert.updatedAt,
          last_detected_at: alert.lastDetectedAt,
        },
        evidence: [],
      }),
    ).toThrow();
  });
});

describe("memory mapping", () => {
  const item: MemoryItem = {
    id: MEMORY_ID,
    projectId: PROJECT_ID,
    kind: "decision",
    summary: "Chose pgvector",
    evidence: EVIDENCE,
    occurredAt: "2026-10-01T10:00:00.000Z",
    status: "open",
  };

  it("round-trips a memory item without touching the embedding column", () => {
    const row = toMemoryItemRow(item);
    expect(row).not.toHaveProperty("embedding");
    expect(fromMemoryItemRow(row)).toEqual(item);
  });

  it("renders an embedding as a pgvector literal", () => {
    expect(toVectorLiteral([0.5, -1, 0])).toBe("[0.5,-1,0]");
  });
});

describe("remaining mappings", () => {
  it("reads capacity, forecasts, reports, sync runs, and llm calls", () => {
    expect(
      fromCapacityRow({
        project_id: PROJECT_ID,
        person: "ana",
        date: "2026-10-01",
        available_hours: "6.50",
        reason: null,
      }),
    ).toEqual({
      projectId: PROJECT_ID,
      person: "ana",
      date: "2026-10-01",
      availableHours: 6.5,
      reason: null,
    });

    expect(
      fromForecastRow({
        id: ALERT_ID,
        project_id: PROJECT_ID,
        kind: "sprint_completion",
        computed_at: "2026-10-01T10:00:00+00:00",
        inputs: { horizonDays: 10 },
        result: { p50: "2026-10-12" },
      }),
    ).toEqual({
      id: ALERT_ID,
      projectId: PROJECT_ID,
      kind: "sprint_completion",
      computedAt: "2026-10-01T10:00:00.000Z",
      inputs: { horizonDays: 10 },
      result: { p50: "2026-10-12" },
    });

    expect(
      fromReportRow({
        id: ALERT_ID,
        project_id: PROJECT_ID,
        kind: "weekly",
        period_start: "2026-10-01",
        period_end: "2026-10-07",
        content: { bullets: [] },
        markdown: "# Week",
        created_by: null,
        created_at: "2026-10-08T10:00:00+00:00",
      }).createdBy,
    ).toBeNull();

    expect(
      fromSyncRunRow({
        id: ALERT_ID,
        project_id: PROJECT_ID,
        source: "jira",
        started_at: "2026-10-01T10:00:00+00:00",
        finished_at: null,
        status: "running",
        stats: {},
        error: null,
      }),
    ).toMatchObject({ finishedAt: null, status: "running", stats: {} });

    expect(
      fromLlmCallRow({
        id: ALERT_ID,
        purpose: "alert_explanation",
        model: "claude-opus-5-5",
        input_tokens: 10,
        output_tokens: 20,
        cache_read_tokens: 0,
        latency_ms: 300,
        stop_reason: null,
        cost_usd: "0.001200",
        created_at: "2026-10-01T10:00:00+00:00",
      }).costUsd,
    ).toBe(0.0012);
  });
});
