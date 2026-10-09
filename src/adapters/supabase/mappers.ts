import {
  AlertSchema,
  CapacityEntrySchema,
  CommitSchema,
  DocRefSchema,
  ForecastSchema,
  IssueCommentSchema,
  IssueEventSchema,
  IssueSchema,
  LlmCallSchema,
  MemoryItemSchema,
  PersonSchema,
  ProjectSchema,
  PullRequestSchema,
  ReportSchema,
  SprintSchema,
  StatusSchema,
  SyncRunSchema,
  TeamMemberSchema,
  TeamSchema,
  WorklogSchema,
  type Alert,
  type CapacityEntry,
  type Commit,
  type DocRef,
  type Forecast,
  type Issue,
  type IssueComment,
  type IssueEvent,
  type LlmCall,
  type MemoryItem,
  type Person,
  type Project,
  type PullRequest,
  type Report,
  type Sprint,
  type Status,
  type SyncRun,
  type Team,
  type TeamMember,
  type Worklog,
} from "@/shared/domain";
import { RepositoryConstraintError } from "@/shared/ports";

/**
 * Row mapping between Postgres (snake_case) and the domain (camelCase).
 *
 * Reads are validated with the domain schemas: a row that does not match the
 * contract fails loudly here instead of reaching the UI as a half-built
 * object. Instants are normalized to UTC ISO strings (`...Z`) so two reads of
 * the same row always produce the same value, whatever offset Postgres
 * rendered.
 *
 * Writes never send a database-assigned `id` for tables whose identity is a
 * natural key (issues, issue events, comments, worklogs, PRs, commits, docs):
 * `on conflict do update` must not touch it.
 */

export type Row = Record<string, unknown>;

/** Narrows a PostgREST payload to an object; anything else is a broken read. */
export function asRow(value: unknown, table: string): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${table}: expected a row object from Supabase.`);
  }
  return value as Row;
}

/** Normalizes a timestamptz to a UTC ISO string; leaves junk for Zod to reject. */
function instant(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? value : new Date(ms).toISOString();
}

function nullableInstant(value: unknown): unknown {
  return value === null || value === undefined ? null : instant(value);
}

/** `numeric` columns may arrive as strings depending on the driver. */
function numeric(value: unknown): unknown {
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? value : parsed;
  }
  return value;
}

function nullableNumeric(value: unknown): unknown {
  return value === null || value === undefined ? null : numeric(value);
}

function nullable(value: unknown): unknown {
  return value === undefined ? null : value;
}

/** pgvector literal (`[0.1,0.2]`) for RPC arguments and inserts. */
export function toVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(",")}]`;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function toProjectRow(project: Project): Row {
  return {
    id: project.id,
    name: project.name,
    jira_key: project.jiraKey,
    github_repo: project.githubRepo,
    client_name: project.clientName,
    budget_amount: project.budgetAmount,
    budget_currency: project.budgetCurrency,
    hourly_rate: project.hourlyRate,
    start_date: project.startDate,
    end_date: project.endDate,
    forecast_unit: project.forecastUnit,
    wip_limit: project.wipLimit,
    board_id: project.boardId ?? null,
  };
}

export function fromProjectRow(value: unknown): Project {
  const row = asRow(value, "projects");
  const boardId = row.board_id;
  return ProjectSchema.parse({
    id: row.id,
    name: row.name,
    jiraKey: row.jira_key,
    githubRepo: row.github_repo,
    clientName: row.client_name,
    budgetAmount: numeric(row.budget_amount),
    budgetCurrency: row.budget_currency,
    hourlyRate: numeric(row.hourly_rate),
    startDate: row.start_date,
    endDate: row.end_date,
    forecastUnit: row.forecast_unit,
    wipLimit: row.wip_limit,
    // `optional()`, not `nullable()`: an absent board is an absent key.
    ...(boardId === null || boardId === undefined ? {} : { boardId }),
  });
}

// ---------------------------------------------------------------------------
// Sprints
// ---------------------------------------------------------------------------

export function toSprintRow(sprint: Sprint): Row {
  return {
    id: sprint.id,
    project_id: sprint.projectId,
    external_id: sprint.externalId,
    name: sprint.name,
    goal: sprint.goal,
    start_at: sprint.startAt,
    end_at: sprint.endAt,
    state: sprint.state,
    committed_points: sprint.committedPoints,
  };
}

export function fromSprintRow(value: unknown): Sprint {
  const row = asRow(value, "sprints");
  return SprintSchema.parse({
    id: row.id,
    projectId: row.project_id,
    externalId: row.external_id,
    name: row.name,
    goal: nullable(row.goal),
    startAt: instant(row.start_at),
    endAt: instant(row.end_at),
    state: row.state,
    committedPoints: nullableNumeric(row.committed_points),
  });
}

// ---------------------------------------------------------------------------
// Issues (identity is `(project_id, key)`; the uuid id stays in the database)
// ---------------------------------------------------------------------------

export function toIssueRow(issue: Issue): Row {
  return {
    project_id: issue.projectId,
    sprint_id: issue.sprintId,
    key: issue.key,
    title: issue.title,
    type: issue.type,
    status: issue.status,
    status_category: issue.statusCategory,
    points: issue.points,
    assignee: issue.assignee,
    requires_code: issue.requiresCode,
    created_at: issue.createdAt,
    updated_at: issue.updatedAt,
    resolved_at: issue.resolvedAt,
    url: issue.url,
  };
}

export function fromIssueRow(value: unknown): Issue {
  const row = asRow(value, "issues");
  return IssueSchema.parse({
    projectId: row.project_id,
    key: row.key,
    title: row.title,
    type: row.type,
    status: row.status,
    statusCategory: row.status_category,
    points: nullableNumeric(row.points),
    assignee: nullable(row.assignee),
    createdAt: instant(row.created_at),
    updatedAt: instant(row.updated_at),
    resolvedAt: nullableInstant(row.resolved_at),
    url: row.url,
    sprintId: nullable(row.sprint_id),
    requiresCode: row.requires_code,
  });
}

// ---------------------------------------------------------------------------
// Issue children: the domain points at an issue KEY, the schema at its uuid
// ---------------------------------------------------------------------------

/** Resolves an issue key to its row id, or rejects like the composite FK would. */
export function requireIssueId(
  table: string,
  issueIdByKey: ReadonlyMap<string, string>,
  projectId: string,
  issueKey: string,
): string {
  const id = issueIdByKey.get(`${projectId}:${issueKey}`);
  if (id === undefined) {
    throw new RepositoryConstraintError(
      `${table}_project_issue_fkey`,
      `${table}: issue ${issueKey} does not exist in its project.`,
    );
  }
  return id;
}

function requireIssueKey(
  table: string,
  issueKeyById: ReadonlyMap<string, string>,
  issueId: unknown,
): string {
  const key = typeof issueId === "string" ? issueKeyById.get(issueId) : undefined;
  if (key === undefined) {
    throw new Error(`${table}: row references an issue that was not read back.`);
  }
  return key;
}

export function toIssueEventRow(event: IssueEvent, issueId: string): Row {
  return {
    project_id: event.projectId,
    issue_id: issueId,
    external_id: event.externalId,
    field: event.field,
    from_value: event.from,
    to_value: event.to,
    at: event.at,
    author: event.author,
  };
}

export function fromIssueEventRow(
  value: unknown,
  issueKeyById: ReadonlyMap<string, string>,
): IssueEvent {
  const row = asRow(value, "issue_events");
  return IssueEventSchema.parse({
    projectId: row.project_id,
    externalId: row.external_id,
    issueKey: requireIssueKey("issue_events", issueKeyById, row.issue_id),
    field: row.field,
    from: nullable(row.from_value),
    to: nullable(row.to_value),
    at: instant(row.at),
    author: nullable(row.author),
  });
}

export function toIssueCommentRow(comment: IssueComment, issueId: string): Row {
  return {
    project_id: comment.projectId,
    issue_id: issueId,
    // The tracker's comment id is the natural key; the uuid is bookkeeping.
    external_id: comment.id,
    author: comment.author,
    body: comment.body,
    created_at: comment.createdAt,
    url: comment.url,
  };
}

export function fromIssueCommentRow(
  value: unknown,
  issueKeyById: ReadonlyMap<string, string>,
): IssueComment {
  const row = asRow(value, "issue_comments");
  return IssueCommentSchema.parse({
    projectId: row.project_id,
    issueKey: requireIssueKey("issue_comments", issueKeyById, row.issue_id),
    id: row.external_id,
    author: row.author,
    body: row.body,
    createdAt: instant(row.created_at),
    url: row.url,
  });
}

export function toWorklogRow(worklog: Worklog, issueId: string): Row {
  return {
    project_id: worklog.projectId,
    issue_id: issueId,
    external_id: worklog.id,
    author: worklog.author,
    seconds: worklog.seconds,
    started_at: worklog.startedAt,
  };
}

export function fromWorklogRow(
  value: unknown,
  issueKeyById: ReadonlyMap<string, string>,
): Worklog {
  const row = asRow(value, "worklogs");
  return WorklogSchema.parse({
    projectId: row.project_id,
    issueKey: requireIssueKey("worklogs", issueKeyById, row.issue_id),
    id: row.external_id,
    author: row.author,
    seconds: row.seconds,
    startedAt: instant(row.started_at),
  });
}

// ---------------------------------------------------------------------------
// Code host
// ---------------------------------------------------------------------------

export function toPullRequestRow(pullRequest: PullRequest): Row {
  return {
    project_id: pullRequest.projectId,
    number: pullRequest.number,
    title: pullRequest.title,
    state: pullRequest.state,
    author: pullRequest.author,
    created_at: pullRequest.createdAt,
    merged_at: pullRequest.mergedAt,
    first_review_at: pullRequest.firstReviewAt,
    linked_issue_keys: [...pullRequest.linkedIssueKeys],
    url: pullRequest.url,
    head_sha: pullRequest.headSha ?? null,
    merge_commit_sha: pullRequest.mergeCommitSha ?? null,
  };
}

export function fromPullRequestRow(value: unknown): PullRequest {
  const row = asRow(value, "pull_requests");
  const headSha = row.head_sha;
  const mergeCommitSha = row.merge_commit_sha;
  return PullRequestSchema.parse({
    projectId: row.project_id,
    number: row.number,
    title: row.title,
    state: row.state,
    author: row.author,
    createdAt: instant(row.created_at),
    mergedAt: nullableInstant(row.merged_at),
    firstReviewAt: nullableInstant(row.first_review_at),
    linkedIssueKeys: row.linked_issue_keys ?? [],
    url: row.url,
    ...(headSha === null || headSha === undefined ? {} : { headSha }),
    ...(mergeCommitSha === null || mergeCommitSha === undefined
      ? {}
      : { mergeCommitSha }),
  });
}

export function toCommitRow(commit: Commit): Row {
  return {
    project_id: commit.projectId,
    sha: commit.sha,
    author: commit.author,
    message: commit.message,
    committed_at: commit.committedAt,
    linked_issue_keys: [...commit.linkedIssueKeys],
    url: commit.url,
  };
}

export function fromCommitRow(value: unknown): Commit {
  const row = asRow(value, "commits");
  return CommitSchema.parse({
    projectId: row.project_id,
    sha: row.sha,
    author: row.author,
    message: row.message,
    committedAt: instant(row.committed_at),
    linkedIssueKeys: row.linked_issue_keys ?? [],
    url: row.url,
  });
}

// ---------------------------------------------------------------------------
// Calendar and docs
// ---------------------------------------------------------------------------

export function toCapacityRow(entry: CapacityEntry): Row {
  return {
    project_id: entry.projectId,
    person: entry.person,
    date: entry.date,
    available_hours: entry.availableHours,
    reason: entry.reason,
  };
}

export function fromCapacityRow(value: unknown): CapacityEntry {
  const row = asRow(value, "capacity");
  return CapacityEntrySchema.parse({
    projectId: row.project_id,
    person: row.person,
    date: row.date,
    availableHours: numeric(row.available_hours),
    reason: nullable(row.reason),
  });
}

export function toDocRow(doc: DocRef): Row {
  return {
    project_id: doc.projectId,
    slug: doc.slug,
    title: doc.title,
    url: doc.url,
    updated_at: doc.updatedAt,
    excerpt: doc.excerpt,
  };
}

export function fromDocRow(value: unknown): DocRef {
  const row = asRow(value, "docs");
  return DocRefSchema.parse({
    projectId: row.project_id,
    slug: row.slug,
    title: row.title,
    url: row.url,
    updatedAt: instant(row.updated_at),
    excerpt: row.excerpt,
  });
}

// ---------------------------------------------------------------------------
// Teams, people, membership, daily statuses
// ---------------------------------------------------------------------------

export function toTeamRow(team: Team): Row {
  return {
    id: team.id,
    project_id: team.projectId,
    name: team.name,
    description: team.description,
    active: team.active,
    created_at: team.createdAt,
    updated_at: team.updatedAt,
  };
}

export function fromTeamRow(value: unknown): Team {
  const row = asRow(value, "teams");
  return TeamSchema.parse({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: nullable(row.description),
    active: row.active,
    createdAt: instant(row.created_at),
    updatedAt: instant(row.updated_at),
  });
}

export function toPersonRow(person: Person): Row {
  return {
    id: person.id,
    full_name: person.fullName,
    email: person.email,
    active: person.active,
    created_at: person.createdAt,
    updated_at: person.updatedAt,
  };
}

export function fromPersonRow(value: unknown): Person {
  const row = asRow(value, "people");
  return PersonSchema.parse({
    id: row.id,
    fullName: row.full_name,
    email: nullable(row.email),
    active: row.active,
    createdAt: instant(row.created_at),
    updatedAt: instant(row.updated_at),
  });
}

export function toTeamMemberRow(member: TeamMember): Row {
  return {
    id: member.id,
    team_id: member.teamId,
    person_id: member.personId,
    role: member.role,
    started_on: member.startedOn,
    ended_on: member.endedOn,
  };
}

export function fromTeamMemberRow(value: unknown): TeamMember {
  const row = asRow(value, "team_members");
  return TeamMemberSchema.parse({
    id: row.id,
    teamId: row.team_id,
    personId: row.person_id,
    role: row.role,
    startedOn: row.started_on,
    endedOn: nullable(row.ended_on),
  });
}

export function toStatusRow(status: Status): Row {
  return {
    id: status.id,
    project_id: status.projectId,
    team_id: status.teamId,
    person_id: status.personId,
    reported_on: status.reportedOn,
    summary: status.summary,
    blockers: status.blockers,
    next_steps: status.nextSteps,
    author_person_id: status.authorPersonId,
    source: status.source,
    created_at: status.createdAt,
    updated_at: status.updatedAt,
  };
}

export function fromStatusRow(value: unknown): Status {
  const row = asRow(value, "statuses");
  return StatusSchema.parse({
    id: row.id,
    projectId: row.project_id,
    teamId: row.team_id,
    personId: row.person_id,
    reportedOn: row.reported_on,
    summary: row.summary,
    blockers: nullable(row.blockers),
    nextSteps: nullable(row.next_steps),
    authorPersonId: row.author_person_id,
    source: row.source,
    createdAt: instant(row.created_at),
    updatedAt: instant(row.updated_at),
  });
}

// ---------------------------------------------------------------------------
// Forecasts, alerts, memory, reports
// ---------------------------------------------------------------------------

export function toForecastRow(forecast: Omit<Forecast, "id">): Row {
  return {
    project_id: forecast.projectId,
    kind: forecast.kind,
    computed_at: forecast.computedAt,
    inputs: forecast.inputs ?? null,
    result: forecast.result ?? null,
  };
}

export function fromForecastRow(value: unknown): Forecast {
  const row = asRow(value, "forecasts");
  return ForecastSchema.parse({
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    computedAt: instant(row.computed_at),
    inputs: row.inputs,
    result: row.result,
  });
}

export function fromAlertRow(value: unknown): Alert {
  const row = asRow(value, "alerts");
  return AlertSchema.parse({
    id: row.id,
    projectId: row.project_id,
    teamId: nullable(row.team_id),
    personId: nullable(row.person_id),
    kind: row.kind,
    severity: row.severity,
    confidence: numeric(row.confidence),
    eta: nullable(row.eta),
    title: row.title,
    explanation: nullable(row.explanation),
    explanationSource: nullable(row.explanation_source),
    drivers: row.drivers ?? [],
    evidence: row.evidence ?? [],
    suggestedActions: row.suggested_actions ?? [],
    status: row.status,
    createdAt: instant(row.created_at),
    updatedAt: instant(row.updated_at),
    lastDetectedAt: instant(row.last_detected_at),
  });
}

export function toMemoryItemRow(item: MemoryItem): Row {
  return {
    id: item.id,
    project_id: item.projectId,
    kind: item.kind,
    summary: item.summary,
    evidence: item.evidence,
    occurred_at: item.occurredAt,
    status: item.status,
  };
}

export function fromMemoryItemRow(value: unknown): MemoryItem {
  const row = asRow(value, "memory_items");
  return MemoryItemSchema.parse({
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    summary: row.summary,
    evidence: row.evidence ?? [],
    occurredAt: instant(row.occurred_at),
    status: row.status,
  });
}

export function toReportRow(report: Omit<Report, "id">): Row {
  return {
    project_id: report.projectId,
    kind: report.kind,
    period_start: report.periodStart,
    period_end: report.periodEnd,
    content: report.content ?? null,
    markdown: report.markdown,
    created_by: report.createdBy,
    created_at: report.createdAt,
  };
}

export function fromReportRow(value: unknown): Report {
  const row = asRow(value, "reports");
  return ReportSchema.parse({
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    content: row.content,
    markdown: row.markdown,
    createdBy: nullable(row.created_by),
    createdAt: instant(row.created_at),
  });
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export function fromSyncRunRow(value: unknown): SyncRun {
  const row = asRow(value, "sync_runs");
  return SyncRunSchema.parse({
    id: row.id,
    projectId: row.project_id,
    source: row.source,
    startedAt: instant(row.started_at),
    finishedAt: nullableInstant(row.finished_at),
    status: row.status,
    stats: row.stats ?? {},
    error: nullable(row.error),
  });
}

export function toLlmCallRow(call: Omit<LlmCall, "id">): Row {
  return {
    purpose: call.purpose,
    model: call.model,
    input_tokens: call.inputTokens,
    output_tokens: call.outputTokens,
    cache_read_tokens: call.cacheReadTokens,
    latency_ms: call.latencyMs,
    stop_reason: call.stopReason,
    cost_usd: call.costUsd,
    created_at: call.createdAt,
  };
}

export function fromLlmCallRow(value: unknown): LlmCall {
  const row = asRow(value, "llm_calls");
  return LlmCallSchema.parse({
    id: row.id,
    purpose: row.purpose,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    latencyMs: row.latency_ms,
    stopReason: nullable(row.stop_reason),
    costUsd: numeric(row.cost_usd),
    createdAt: instant(row.created_at),
  });
}
