import "server-only";

import {
  InMemoryRadarRepository,
  buildDemoDataset,
  createDemoSources,
} from "@/adapters/demo";
import { createLlm } from "@/adapters/llm";
import {
  SupabaseRadarRepository,
  createServiceRoleClient,
} from "@/adapters/supabase";
import { systemClock } from "@/adapters/system-clock";
import { createUnavailableSources } from "@/adapters/unavailable";
import { explainAlerts } from "@/modules/forecast/application/explain-alerts";
import { runForecasts } from "@/modules/forecast/application/run-forecasts";
import { buildMemory } from "@/modules/memory/application/build-memory";
import { syncProjects } from "@/modules/ingestion/application/sync-projects";
import { getEnv, type Env } from "@/shared/config/env";
import { toIsoDate } from "@/shared/domain";
import type { Clock, LlmPort, RadarRepository, SourcePorts } from "@/shared/ports";

/**
 * Composition root.
 *
 * This is the ONLY module allowed to choose between demo and live adapters.
 * Routes, use cases, and UI receive ports from here and never import
 * `@/adapters/*` directly (enforced by ESLint `no-restricted-imports`).
 *
 * The container never exposes secrets: API keys and tokens are consumed here
 * when adapters are constructed, and only non-secret config and ports leave
 * this module.
 *
 * Live mode (decision D-030): the container holds ONE service-role Supabase
 * repository, used for every read and write. The service role bypasses RLS,
 * so the policies in `0002_rls.sql` are not the enforcement layer today and
 * the deployment is effectively unauthenticated. Authentication and the
 * request-scoped RLS repository are still pending; see D-030 and the README.
 */

export type AppMode = "demo" | "live";

/** Non-secret runtime configuration, available synchronously and without IO. */
export interface AppConfig {
  mode: AppMode;
  /** Anthropic model id used for explanations, reports, and chat. */
  model: string;
  /** Public base URL of the deployment, when configured. */
  appUrl: string | undefined;
  /**
   * Whether an Anthropic API key is configured. False means every AI path
   * degrades: alert explanations come from the deterministic template and
   * Ask Flock-Radar is disabled with an explanation instead of failing.
   */
  llmAvailable: boolean;
}

export interface Container extends AppConfig {
  clock: Clock;
  repo: RadarRepository;
  sources: SourcePorts;
  llm: LlmPort;
}

function toAppConfig(env: Env): AppConfig {
  return {
    mode: env.DEMO_MODE ? "demo" : "live",
    model: env.ANTHROPIC_MODEL,
    appUrl: env.NEXT_PUBLIC_APP_URL,
    llmAvailable: env.ANTHROPIC_API_KEY !== undefined,
  };
}

/**
 * Mode, model, and URL without building the container. Use it where only
 * configuration is needed (e.g. the header badge), so static rendering never
 * reads the clock or boots the demo data.
 */
export function getAppConfig(): AppConfig {
  return toAppConfig(getEnv());
}

/**
 * Demo boot: build the scenario anchored to today, then run it through the
 * real sync pipeline (sources -> sync use case -> repository), exactly like a
 * live cron sync would. Teams, people, and daily statuses are seeded directly
 * (they are authored, not synced), then run the forecast engine and the
 * memory pipeline
 * so the container starts with forecasts, alerts, and memory items. Repository
 * ids are deterministic, so every instance booted on the same day agrees on
 * alert and memory item ids.
 */
async function buildDemoContainer(
  config: AppConfig,
  clock: Clock,
  llm: LlmPort,
): Promise<Container> {
  const dataset = buildDemoDataset(clock.now());
  const repo = new InMemoryRadarRepository({
    ids: "deterministic",
    now: () => clock.now(),
  });
  const sources = createDemoSources(dataset);

  for (const project of dataset.projects) {
    await repo.projects.upsert(project);
  }

  // Teams, people, and statuses are NOT synced from a source: a status is a
  // first-class, user-authored record (D-053), so the demo seeds it straight
  // into the repository, in dependency order.
  await repo.people.upsertMany(dataset.people);
  for (const team of dataset.teams) {
    await repo.teams.upsert(team);
  }
  await repo.teamMembers.upsertMany(dataset.teamMembers);
  await repo.statuses.upsertMany(dataset.statuses);

  const sync = await syncProjects({ repo, clock, ...sources });
  if (sync.status !== "ok") {
    const failures = sync.runs
      .filter((run) => run.status !== "ok")
      .map((run) => run.error ?? `${run.source}: ${run.status}`)
      .join("; ");
    throw new Error(`Demo data failed to sync: ${failures}`);
  }

  const forecasts = await runForecasts({ repo, clock });
  const forecastFailures = forecasts.projects.filter((project) => project.error !== null);
  if (forecastFailures.length > 0) {
    throw new Error(
      `Demo forecasts failed: ${forecastFailures
        .map((project) => `${project.projectName}: ${project.error}`)
        .join("; ")}`,
    );
  }

  const memory = await buildMemory({ repo, clock });
  const memoryFailures = memory.projects.filter((project) => project.error !== null);
  if (memoryFailures.length > 0) {
    throw new Error(
      `Demo memory failed: ${memoryFailures
        .map((project) => `${project.projectName}: ${project.error}`)
        .join("; ")}`,
    );
  }

  const explanations = await explainAlerts({ repo, clock, llm });
  const explanationFailures = explanations.projects.filter(
    (project) => project.error !== null,
  );
  if (explanationFailures.length > 0) {
    throw new Error(
      `Demo explanations failed: ${explanationFailures
        .map((project) => `${project.projectName}: ${project.error}`)
        .join("; ")}`,
    );
  }

  return { ...config, clock, repo, sources, llm };
}

async function buildContainer(
  config: AppConfig,
  clock: Clock,
  env: Env,
): Promise<Container> {
  const llm = createLlm({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL });

  if (config.mode === "demo") {
    return buildDemoContainer(config, clock, llm);
  }

  // Live mode: the Supabase repository reads whatever the database already
  // holds. It never syncs on boot — ingestion is the cron job's business, and
  // the Jira/GitHub/Calendar/Docs source adapters are still unavailable.
  const repo = new SupabaseRadarRepository(
    createServiceRoleClient({
      url: env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    }),
  );

  return { ...config, clock, repo, sources: createUnavailableSources(), llm };
}

/**
 * Cached on `globalThis` so every module instance in the process (React
 * Server Components and route handlers can load separate copies of this
 * module) shares one container.
 */
const CONTAINER_CACHE = Symbol.for("radar.composition-root.container");

interface CachedContainer {
  key: string;
  promise: Promise<Container>;
}

type GlobalWithContainer = typeof globalThis & {
  [CONTAINER_CACHE]?: CachedContainer;
};

/**
 * Demo data is anchored to the UTC day, so the demo container is keyed by
 * that day and rebuilt after midnight; live mode is keyed by config only.
 */
function cacheKey(config: AppConfig, clock: Clock): string {
  const day = config.mode === "demo" ? toIsoDate(clock.now()) : "";
  return JSON.stringify([
    config.mode,
    config.model,
    config.appUrl ?? "",
    config.llmAvailable,
    day,
  ]);
}

/**
 * Returns the process-wide container, built on first access and rebuilt
 * when the demo day changes. A failed build is not cached, so the next call
 * retries.
 */
export function getContainer(): Promise<Container> {
  const store = globalThis as GlobalWithContainer;
  const clock = systemClock;

  let env: Env;
  let config: AppConfig;
  try {
    env = getEnv();
    config = toAppConfig(env);
  } catch (error) {
    return Promise.reject(error);
  }

  const key = cacheKey(config, clock);
  const cached = store[CONTAINER_CACHE];
  if (cached?.key === key) return cached.promise;

  const entry: CachedContainer = {
    key,
    promise: buildContainer(config, clock, env).catch((error: unknown) => {
      if (store[CONTAINER_CACHE] === entry) delete store[CONTAINER_CACHE];
      throw error;
    }),
  };
  store[CONTAINER_CACHE] = entry;
  return entry.promise;
}

/** Drops the cached container (tests, and an admin "reload demo" later). */
export function resetContainer(): void {
  delete (globalThis as GlobalWithContainer)[CONTAINER_CACHE];
}
