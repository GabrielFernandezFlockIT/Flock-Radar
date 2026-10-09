import type {
  Alert,
  AlertKind,
  AlertStatus,
  CapacityEntry,
  Commit,
  DateRange,
  DocRef,
  Forecast,
  Issue,
  IssueComment,
  IssueEvent,
  LlmCall,
  LlmUsageTotals,
  MemoryItem,
  MemoryItemKind,
  MemoryItemStatus,
  Person,
  Project,
  PullRequest,
  Report,
  Sprint,
  Status,
  SyncRun,
  SyncRunStats,
  SyncRunStatus,
  SyncSource,
  Team,
  TeamMember,
  Worklog,
} from "@/shared/domain";

/**
 * Persistence port for the whole data spine.
 *
 * One interface with namespaced groups, so the in-memory adapter (demo) and
 * the Supabase adapter (live) implement exactly the same contract and the
 * composition root can swap them as a unit.
 *
 * Contract shared by every implementation (the in-memory adapter enforces the
 * same rules Postgres does, see decision D-032):
 * - `upsertMany` is idempotent on each entity's natural key (noted per group);
 *   re-syncing the same data never duplicates rows.
 * - A batch must not contain the same natural key twice. Callers dedupe first
 *   (`syncProjects` keeps the last occurrence); repositories reject duplicates
 *   with a `RepositoryConstraintError`, like Postgres' "ON CONFLICT DO UPDATE
 *   cannot affect row a second time".
 * - Writes that reference a missing parent are rejected with a
 *   `RepositoryConstraintError`: every project-scoped row needs its project;
 *   issues need their sprint (same project); issue events, comments, and
 *   worklogs need their issue (same project); team members need their team
 *   and person; statuses need their project, their person, their author, and
 *   a team that belongs to the SAME project.
 * - Reads return copies; mutating a returned object never changes stored data.
 * - Lists are ordered deterministically (noted per method).
 * - Writes reject invalid records (schema violations) instead of storing them.
 */

/**
 * Alert fields the caller controls when upserting the active alert of a kind.
 * `teamId` and `personId` are part of it: they identify WHICH active alert of
 * that kind the draft targets (D-054).
 */
export type AlertDraft = Omit<
  Alert,
  | "id"
  | "projectId"
  | "kind"
  | "status"
  | "createdAt"
  | "updatedAt"
  | "lastDetectedAt"
> & {
  /**
   * When the detector fired. Sets `lastDetectedAt` and `updatedAt` on every
   * upsert, and `createdAt` when a new alert is created.
   */
  detectedAt: string;
};

export type ForecastInput = Omit<Forecast, "id">;
export type ReportInput = Omit<Report, "id">;
export type LlmCallInput = Omit<LlmCall, "id">;

/** A memory item plus its embedding (optional until the embedder runs). */
export type MemoryItemInput = MemoryItem & {
  embedding?: readonly number[];
};

/** Most results `memory.search` returns, whatever `k` asks for. */
export const MAX_MEMORY_SEARCH_RESULTS = 50;

export interface MemorySearchHit {
  item: MemoryItem;
  /** Cosine similarity in [-1, 1]; higher is closer. */
  similarity: number;
}

export interface SyncRunOutcome {
  finishedAt: string;
  status: Exclude<SyncRunStatus, "running">;
  stats: SyncRunStats;
  error: string | null;
}

export interface RadarRepository {
  projects: {
    /** Ordered by name. */
    list(): Promise<Project[]>;
    get(id: string): Promise<Project | null>;
    /** Keyed by `id`; `jiraKey` must stay unique across projects. */
    upsert(project: Project): Promise<Project>;
  };

  sprints: {
    /** Ordered by `startAt`. */
    byProject(projectId: string): Promise<Sprint[]>;
    /**
     * The sprint in state `active` that contains `at`; otherwise any `active`
     * sprint; otherwise the sprint whose window contains `at`; else `null`.
     */
    active(projectId: string, at: Date): Promise<Sprint | null>;
    /**
     * Natural key `(projectId, externalId)` is the upsert target. The `id` of
     * an existing sprint is never overwritten: a sprint with a known natural
     * key but a different `id` is rejected.
     */
    upsertMany(sprints: readonly Sprint[]): Promise<void>;
  };

  issues: {
    /** Ordered by key number. */
    byProject(projectId: string): Promise<Issue[]>;
    /** Ordered by key number. */
    bySprint(sprintId: string): Promise<Issue[]>;
    /** Keyed by `(projectId, key)`. */
    upsertMany(issues: readonly Issue[]): Promise<void>;
  };

  issueEvents: {
    /** Ordered by `at`. */
    byProject(projectId: string): Promise<IssueEvent[]>;
    /** Keyed by `(projectId, externalId)`. */
    upsertMany(events: readonly IssueEvent[]): Promise<void>;
  };

  issueComments: {
    /** Ordered by `createdAt`. */
    byProject(projectId: string): Promise<IssueComment[]>;
    /** Keyed by `(projectId, id)`. */
    upsertMany(comments: readonly IssueComment[]): Promise<void>;
  };

  worklogs: {
    /** Ordered by `startedAt`. */
    byProject(projectId: string): Promise<Worklog[]>;
    /** Keyed by `(projectId, id)`. */
    upsertMany(worklogs: readonly Worklog[]): Promise<void>;
  };

  pullRequests: {
    /** Ordered by `number`. */
    byProject(projectId: string): Promise<PullRequest[]>;
    /** Keyed by `(projectId, number)`. */
    upsertMany(pullRequests: readonly PullRequest[]): Promise<void>;
  };

  commits: {
    /** Ordered by `committedAt`. */
    byProject(projectId: string): Promise<Commit[]>;
    /** Keyed by `(projectId, sha)`. */
    upsertMany(commits: readonly Commit[]): Promise<void>;
  };

  capacity: {
    /** Ordered by date, then person. Optionally limited to an inclusive day range. */
    byProject(projectId: string, range?: DateRange): Promise<CapacityEntry[]>;
    /** Keyed by `(projectId, person, date)`. */
    upsertMany(entries: readonly CapacityEntry[]): Promise<void>;
  };

  docs: {
    /** Ordered by slug. */
    byProject(projectId: string): Promise<DocRef[]>;
    /** Keyed by `(projectId, slug)`. */
    upsertMany(docs: readonly DocRef[]): Promise<void>;
  };

  forecasts: {
    /** Most recent by `computedAt`, or `null`. */
    latest(projectId: string, kind: string): Promise<Forecast | null>;
    /** Append-only history; the repository assigns the id. */
    insert(forecast: ForecastInput): Promise<Forecast>;
  };

  alerts: {
    /** Ordered by `createdAt`. */
    byProject(projectId: string, status?: AlertStatus): Promise<Alert[]>;
    /**
     * At most one active (`open` or `ack`) alert exists per (project, kind,
     * teamId, personId) — the SUBJECT is part of the key, so the same kind
     * may be active for two different people at the same time. Updates that
     * alert in place (keeping id, status, createdAt) or, when none is active
     * (e.g. the last one was resolved), creates a new `open` alert. Rejects
     * drafts without evidence.
     */
    upsertForKind(
      projectId: string,
      kind: AlertKind,
      draft: AlertDraft,
    ): Promise<Alert>;
    /**
     * Returns the updated alert, or `null` when the id is unknown. Throws
     * `AlertConflictError` when reactivating an alert would create a second
     * active alert of the same kind. User-facing transitions are validated
     * with `canTransitionAlert` by the caller (and by a DB trigger in live mode).
     */
    setStatus(id: string, status: AlertStatus): Promise<Alert | null>;
  };

  teams: {
    /** Ordered by name, then id. Optionally limited to active (or inactive) teams. */
    byProject(projectId: string, filter?: { active?: boolean }): Promise<Team[]>;
    get(id: string): Promise<Team | null>;
    /**
     * Keyed by `id`; `(projectId, name)` must stay unique across teams, and a
     * stored team never changes project.
     */
    upsert(team: Team): Promise<Team>;
    /** Soft delete/restore. Returns the updated team, or `null` when unknown. */
    setActive(id: string, active: boolean): Promise<Team | null>;
  };

  people: {
    /** Ordered by `fullName`, then id. Optionally limited by `active`. */
    list(filter?: { active?: boolean }): Promise<Person[]>;
    get(id: string): Promise<Person | null>;
    /** Keyed by `id`; a non-null `email` must stay unique across people. */
    upsertMany(people: readonly Person[]): Promise<void>;
    /**
     * People whose `fullName` CONTAINS `name`, case- and accent-insensitively
     * for the Latin-1 letters the directory uses. Ordered like `list`; a blank
     * query returns nothing.
     */
    search(name: string): Promise<Person[]>;
  };

  teamMembers: {
    /** Ordered by `startedOn`, then `personId`. */
    byTeam(teamId: string): Promise<TeamMember[]>;
    /** Ordered by `startedOn`, then `teamId`. */
    byPerson(personId: string): Promise<TeamMember[]>;
    /**
     * Keyed by `(teamId, personId, startedOn)`. The `id` of an existing
     * membership is never overwritten: a known natural key carrying a
     * different `id` is rejected, like sprints.
     */
    upsertMany(members: readonly TeamMember[]): Promise<void>;
    /** Returns `true` when a membership was removed, `false` when unknown. */
    remove(id: string): Promise<boolean>;
  };

  statuses: {
    /** Ordered by `reportedOn`, then `personId`. Optional inclusive day range. */
    byTeam(teamId: string, range?: DateRange): Promise<Status[]>;
    /** Ordered by `reportedOn`. Optional inclusive day range. */
    byPerson(personId: string, range?: DateRange): Promise<Status[]>;
    /** Ordered by `reportedOn`, then `personId`. Optional inclusive day range. */
    byProject(projectId: string, range?: DateRange): Promise<Status[]>;
    /**
     * Keyed by the natural key `(personId, reportedOn)`: re-reporting the same
     * day REPLACES the entry. The `id` is never overwritten, so a known
     * natural key carrying a different `id` is rejected. Rejects a `teamId`
     * that does not belong to `projectId`, like the composite foreign key.
     */
    upsert(status: Status): Promise<Status>;
    /** Batch form of `upsert`, same key and same rejections. */
    upsertMany(statuses: readonly Status[]): Promise<void>;
    /** Returns `true` when a status was deleted, `false` when unknown. */
    delete(id: string): Promise<boolean>;
  };

  memory: {
    /** Ordered by `occurredAt`. */
    byProject(
      projectId: string,
      filter?: { kind?: MemoryItemKind; status?: MemoryItemStatus },
    ): Promise<MemoryItem[]>;
    /**
     * Keyed by `id`. An omitted embedding keeps the stored one only while the
     * summary is unchanged; a new summary without a new embedding clears it
     * (a stale vector would match the old text).
     */
    upsertMany(items: readonly MemoryItemInput[]): Promise<void>;
    /**
     * Top `k` items of the project by cosine similarity, at most
     * `MAX_MEMORY_SEARCH_RESULTS`. `k <= 0` returns nothing; items without an
     * embedding and zero vectors (no direction) never match, and a zero query
     * vector returns nothing.
     */
    search(
      projectId: string,
      queryEmbedding: readonly number[],
      k: number,
    ): Promise<MemorySearchHit[]>;
  };

  reports: {
    /** Newest first. */
    byProject(projectId: string): Promise<Report[]>;
    get(id: string): Promise<Report | null>;
    /** The repository assigns the id. */
    insert(report: ReportInput): Promise<Report>;
  };

  syncRuns: {
    /** Creates a `running` run of one source for one project; the repository assigns the id. */
    start(input: {
      projectId: string;
      source: SyncSource;
      startedAt: string;
    }): Promise<SyncRun>;
    /** Rejects when the id is unknown. */
    finish(id: string, outcome: SyncRunOutcome): Promise<SyncRun>;
    /** The project's most recent run of each source that has one, in `SYNC_SOURCES` order. */
    latestBySource(projectId: string): Promise<SyncRun[]>;
  };

  llmCalls: {
    /** The repository assigns the id. */
    insert(call: LlmCallInput): Promise<LlmCall>;
    totals(): Promise<LlmUsageTotals>;
  };
}
