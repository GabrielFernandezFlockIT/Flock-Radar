import {
  DAY_MS,
  type MemoryItem,
  type MemoryItemKind,
  type Project,
} from "@/shared/domain";
import type { Clock, RadarRepository } from "@/shared/ports";

import {
  DEFAULT_MEMORY_OPTIONS,
  PENDING_RULES,
  PENDING_RULE_BY_LABEL,
  RULE_SEPARATOR,
  buildMemoryItems,
  type MemoryOptions,
  type MemorySnapshot,
} from "../domain";

/**
 * Memory use case: for every project, load the records through the repository
 * port, run every rule (pure), and upsert the result.
 *
 * - Idempotent: item ids are derived from (project, kind, record key), so a
 *   rerun on the same data upserts the same rows instead of duplicating them.
 * - Rule-based only in this slice. The Claude extraction seam is
 *   `MemoryNarrator`; no LLM call happens here.
 * - A failing project is reported in the summary and does not stop the others.
 * - Embeddings are NOT written: `memory.search` stays unimplemented until the
 *   Embedder port lands (phase 6/7, see docs/decisions.md).
 */

export interface BuildMemoryDeps {
  repo: RadarRepository;
  clock: Clock;
  options?: MemoryOptions;
}

export interface ProjectMemorySummary {
  projectId: string;
  projectName: string;
  /** Items written for this project, by kind. */
  countsByKind: Record<MemoryItemKind, number>;
  itemsStored: number;
  error: string | null;
}

export interface BuildMemoryResult {
  builtAt: string;
  projects: ProjectMemorySummary[];
}

function emptyCounts(): Record<MemoryItemKind, number> {
  return { done: 0, pending: 0, decision: 0, risk: 0, next_step: 0 };
}

async function loadSnapshot(
  repo: RadarRepository,
  project: Project,
  now: Date,
): Promise<MemorySnapshot> {
  const [issues, issueEvents, issueComments, pullRequests, commits, docs] = await Promise.all([
    repo.issues.byProject(project.id),
    repo.issueEvents.byProject(project.id),
    repo.issueComments.byProject(project.id),
    repo.pullRequests.byProject(project.id),
    repo.commits.byProject(project.id),
    repo.docs.byProject(project.id),
  ]);
  return { project, now, issues, issueEvents, issueComments, pullRequests, commits, docs };
}

function describeError(error: unknown): string {
  return error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name)
    ? `memory failed: ${error.name}`
    : "memory failed";
}

async function buildProjectMemory(
  repo: RadarRepository,
  project: Project,
  now: Date,
  options: MemoryOptions,
): Promise<ProjectMemorySummary> {
  const snapshot = await loadSnapshot(repo, project, now);
  const { items } = buildMemoryItems(snapshot, options);
  await repo.memory.upsertMany(items);

  const countsByKind = emptyCounts();
  for (const item of items) countsByKind[item.kind] += 1;
  return {
    projectId: project.id,
    projectName: project.name,
    countsByKind,
    itemsStored: items.length,
    error: null,
  };
}

export async function buildMemory(deps: BuildMemoryDeps): Promise<BuildMemoryResult> {
  const { repo, clock } = deps;
  const options = deps.options ?? DEFAULT_MEMORY_OPTIONS;
  const now = clock.now();
  const projects = await repo.projects.list();

  const summaries: ProjectMemorySummary[] = [];
  for (const project of projects) {
    try {
      summaries.push(await buildProjectMemory(repo, project, now, options));
    } catch (error) {
      summaries.push({
        projectId: project.id,
        projectName: project.name,
        countsByKind: emptyCounts(),
        itemsStored: 0,
        error: describeError(error),
      });
    }
  }

  return { builtAt: now.toISOString(), projects: summaries };
}

// ---------------------------------------------------------------------------
// Weekly digest
// ---------------------------------------------------------------------------

export interface PendingGroup {
  ruleId: string;
  label: string;
  /** One line explaining why the rule fires; shown under the group heading. */
  why: string;
  items: MemoryItem[];
}

export interface MemoryOverview {
  done: MemoryItem[];
  pending: PendingGroup[];
  decisions: MemoryItem[];
  risks: MemoryItem[];
  nextSteps: MemoryItem[];
}

export interface WeeklyDigest extends MemoryOverview {
  projectId: string;
  from: string;
  to: string;
}

export interface WeeklyDigestDeps {
  repo: RadarRepository;
  projectId: string;
  now: Date;
  /** Window length in days; defaults to `DEFAULT_MEMORY_OPTIONS.digestDays`. */
  days?: number;
}

/**
 * The rule a stored pending item came from, read back from its summary
 * prefix. `MemoryItem` has no rule column, and the summary template is stable
 * (`"<label> — <detail>"`), so the prefix is the grouping key.
 */
export function pendingRuleOf(item: MemoryItem): { id: string; label: string; why: string } {
  const label = item.summary.split(RULE_SEPARATOR)[0];
  return (
    PENDING_RULE_BY_LABEL.get(label) ?? {
      id: "other",
      label: "Otros",
      why: "Detectado por una regla que ya no está registrada.",
    }
  );
}

/** Splits stored items by kind and groups the pending ones by their rule. */
export function summarizeMemory(items: readonly MemoryItem[]): MemoryOverview {
  const of = (kind: MemoryItemKind) => items.filter((item) => item.kind === kind);

  const groups = new Map<string, PendingGroup>();
  for (const rule of Object.values(PENDING_RULES)) {
    groups.set(rule.id, { ruleId: rule.id, label: rule.label, why: rule.why, items: [] });
  }
  for (const item of of("pending")) {
    const rule = pendingRuleOf(item);
    const group = groups.get(rule.id);
    if (group) {
      group.items.push(item);
      continue;
    }
    groups.set(rule.id, { ruleId: rule.id, label: rule.label, why: rule.why, items: [item] });
  }

  return {
    done: of("done"),
    pending: [...groups.values()].filter((group) => group.items.length > 0),
    decisions: of("decision"),
    risks: of("risk"),
    nextSteps: of("next_step"),
  };
}

/**
 * Done / pending / decisions / next steps for the window, each with evidence.
 *
 * The window applies to what HAPPENED (`status: "resolved"`: work finished,
 * decisions recorded). Items still `open` — pending work, live risks — are
 * always included: a question unanswered for three weeks is more urgent than
 * one unanswered since Monday, and dropping it out of the digest because it
 * started too long ago is exactly the blind spot this module exists to close.
 */
export async function getWeeklyDigest(deps: WeeklyDigestDeps): Promise<WeeklyDigest> {
  const { repo, projectId, now } = deps;
  const days = deps.days ?? DEFAULT_MEMORY_OPTIONS.digestDays;
  const fromMs = now.getTime() - days * DAY_MS;
  const items = await repo.memory.byProject(projectId);
  const inWindow = items.filter((item) => {
    if (item.status === "open") return true;
    const at = Date.parse(item.occurredAt);
    return at >= fromMs && at <= now.getTime();
  });

  return {
    projectId,
    from: new Date(fromMs).toISOString(),
    to: now.toISOString(),
    ...summarizeMemory(inWindow),
  };
}
