import {
  ExplanationSchema,
  type Alert,
  type AlertExplanationInput,
  type Explanation,
  type ExplanationSource,
  type Project,
} from "@/shared/domain";
import type { Clock, LlmCallRecord, LlmPort, RadarRepository } from "@/shared/ports";

import { templateExplanation } from "../domain";

/**
 * Explanation use case (PROMPT §5.1, phase 4).
 *
 * Runs after `runForecasts`: every active alert gets an `explanation` and an
 * `explanationSource`. The LLM is asked first; the deterministic template is
 * the floor. The floor is load-bearing — without `ANTHROPIC_API_KEY` the LLM
 * port reports `available: false` and every alert is explained from its own
 * drivers, so the demo never depends on the API being reachable.
 *
 * Idempotence: results are cached by a hash of the exact inputs, so a rerun on
 * unchanged data writes nothing and calls nothing.
 */

export interface ProjectExplanationSummary {
  projectId: string;
  projectName: string;
  /** Alerts explained by the model in this run. */
  llm: number;
  /** Alerts explained from the deterministic template in this run. */
  template: number;
  /** Alerts already explained with the same inputs. */
  unchanged: number;
  /** Short reasons the LLM path was not used, for the admin view and logs. */
  fallbackReasons: string[];
  error: string | null;
}

export interface ExplainAlertsResult {
  explainedAt: string;
  llmAvailable: boolean;
  projects: ProjectExplanationSummary[];
}

export interface ExplanationCache {
  get(key: string): CachedExplanation | undefined;
  set(key: string, value: CachedExplanation): void;
}

export interface CachedExplanation {
  explanation: Explanation;
  source: ExplanationSource;
}

/**
 * Process-wide by default: the demo container is rebuilt per UTC day and the
 * cron sync runs repeatedly in one process, and neither should re-pay for an
 * explanation whose inputs did not move.
 */
const defaultCache = new Map<string, CachedExplanation>();

/** Test seam; also used when a demo container is rebuilt from scratch. */
export function clearExplanationCache(): void {
  defaultCache.clear();
}

export function toExplanationInput(
  alert: Alert,
  project: Project,
): AlertExplanationInput {
  return {
    kind: alert.kind,
    severity: alert.severity,
    confidence: alert.confidence,
    eta: alert.eta,
    title: alert.title,
    drivers: alert.drivers,
    evidence: alert.evidence,
    project: {
      name: project.name,
      clientName: project.clientName,
      startDate: project.startDate,
      endDate: project.endDate,
      budgetAmount: project.budgetAmount,
      budgetCurrency: project.budgetCurrency,
    },
  };
}

/**
 * Stable because the input object is built field by field above, so key order
 * never varies between runs or processes.
 */
export function explanationCacheKey(
  input: AlertExplanationInput,
  model: string,
): string {
  return `${model}\u0000${JSON.stringify(input)}`;
}

function describeError(error: unknown): string {
  return error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name)
    ? `explanation failed: ${error.name}`
    : "explanation failed";
}

async function logCalls(
  repo: RadarRepository,
  calls: readonly LlmCallRecord[],
  at: string,
): Promise<void> {
  for (const call of calls) {
    await repo.llmCalls.insert({ ...call, createdAt: at });
  }
}

async function explainProject(
  deps: ExplainAlertsDeps,
  project: Project,
  now: string,
): Promise<ProjectExplanationSummary> {
  const { repo, llm } = deps;
  const cache = deps.cache ?? defaultCache;
  const summary: ProjectExplanationSummary = {
    projectId: project.id,
    projectName: project.name,
    llm: 0,
    template: 0,
    unchanged: 0,
    fallbackReasons: [],
    error: null,
  };

  const alerts = [
    ...(await repo.alerts.byProject(project.id, "open")),
    ...(await repo.alerts.byProject(project.id, "ack")),
  ];

  for (const alert of alerts) {
    const input = toExplanationInput(alert, project);
    const key = explanationCacheKey(input, llm.model);
    const cached = cache.get(key);

    if (cached && alert.explanation !== null) {
      summary.unchanged += 1;
      continue;
    }

    let resolved = cached;
    if (!resolved) {
      const outcome = await llm.explainAlert(input);
      await logCalls(repo, outcome.calls, now);

      if (outcome.status === "ok") {
        // The adapter is still an adapter: validate before trusting it.
        const parsed = ExplanationSchema.safeParse(outcome.explanation);
        resolved = parsed.success
          ? { explanation: parsed.data, source: "llm" }
          : { explanation: templateExplanation(input), source: "template" };
        if (!parsed.success) summary.fallbackReasons.push("invalid explanation shape");
      } else {
        resolved = { explanation: templateExplanation(input), source: "template" };
        if (outcome.reason !== "unavailable") {
          summary.fallbackReasons.push(`${outcome.reason}: ${outcome.detail}`);
        }
      }
      cache.set(key, resolved);
    }

    await repo.alerts.upsertForKind(project.id, alert.kind, {
      // Explaining must target the SAME active alert, so the subject is
      // carried over unchanged.
      teamId: alert.teamId,
      personId: alert.personId,
      severity: alert.severity,
      confidence: alert.confidence,
      eta: alert.eta,
      title: alert.title,
      explanation: `${resolved.explanation.headline}\n\n${resolved.explanation.why}`,
      explanationSource: resolved.source,
      drivers: alert.drivers,
      evidence: alert.evidence,
      suggestedActions: resolved.explanation.suggestedActions,
      // Explaining is not a detection: keep the detector's own timestamp.
      detectedAt: alert.lastDetectedAt,
    });

    if (resolved.source === "llm") summary.llm += 1;
    else summary.template += 1;
  }

  return summary;
}

export interface ExplainAlertsDeps {
  repo: RadarRepository;
  llm: LlmPort;
  clock: Clock;
  cache?: ExplanationCache;
}

export async function explainAlerts(
  deps: ExplainAlertsDeps,
): Promise<ExplainAlertsResult> {
  const now = deps.clock.now().toISOString();
  const projects = await deps.repo.projects.list();
  const summaries: ProjectExplanationSummary[] = [];

  for (const project of projects) {
    try {
      summaries.push(await explainProject(deps, project, now));
    } catch (error) {
      summaries.push({
        projectId: project.id,
        projectName: project.name,
        llm: 0,
        template: 0,
        unchanged: 0,
        fallbackReasons: [],
        error: describeError(error),
      });
    }
  }

  return { explainedAt: now, llmAvailable: deps.llm.available, projects: summaries };
}
