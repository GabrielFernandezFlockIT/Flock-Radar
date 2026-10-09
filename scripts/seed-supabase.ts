/**
 * Seeds a live Supabase project with the demo scenario.
 *
 * Runs the SAME pipeline demo mode boots with — build the dataset, upsert the
 * projects, sync through `syncProjects`, then `runForecasts` and `buildMemory`
 * — but against the Supabase repository, so the live database ends up holding
 * projects, issues, PRs, capacity, forecasts, alerts, and memory items.
 *
 * Idempotent: every write targets a natural key, and the scenario is
 * deterministic per UTC day, so re-running the same day changes nothing.
 * Forecast rows are the one exception: `forecasts` is an append-only history
 * by design (see the port), so each run appends one row per project and kind.
 *
 * Requires the migrations in `supabase/migrations` to be applied first, plus
 * NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
 *
 *   npm run seed:supabase
 */

import { buildDemoDataset, createDemoSources } from "@/adapters/demo";
import {
  SupabaseRadarRepository,
  createServiceRoleClient,
} from "@/adapters/supabase";
import { systemClock } from "@/adapters/system-clock";
import { runForecasts } from "@/modules/forecast/application/run-forecasts";
import { syncProjects } from "@/modules/ingestion/application/sync-projects";
import { buildMemory } from "@/modules/memory/application/build-memory";

const REQUIRED = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

function readConfig(): { url: string; serviceRoleKey: string } {
  const missing = REQUIRED.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    console.error(
      [
        `seed:supabase needs ${missing.join(" and ")}.`,
        "",
        "Set them in .env.local (or export them) and make sure the migrations in",
        "supabase/migrations have been applied to that project first:",
        "",
        "  NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co",
        "  SUPABASE_SERVICE_ROLE_KEY=<service role key>",
        "",
        "Nothing was written.",
      ].join("\n"),
    );
    process.exit(1);
  }
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "",
  };
}

async function main(): Promise<void> {
  const config = readConfig();
  const clock = systemClock;
  const repo = new SupabaseRadarRepository(createServiceRoleClient(config));
  const dataset = buildDemoDataset(clock.now());

  console.log(`Seeding ${dataset.projects.length} demo projects (anchor ${dataset.anchorDate})...`);

  // Projects first: every other table carries a foreign key to them.
  for (const project of dataset.projects) {
    await repo.projects.upsert(project);
    console.log(`  project ${project.jiraKey} (${project.name})`);
  }

  const sync = await syncProjects({ repo, clock, ...createDemoSources(dataset) });
  if (sync.status !== "ok") {
    const failures = sync.runs
      .filter((run) => run.status !== "ok")
      .map((run) => run.error ?? `${run.source}: ${run.status}`)
      .join("; ");
    throw new Error(`Sync failed: ${failures}`);
  }
  console.log(`  synced ${sync.runs.length} source runs`);

  const forecasts = await runForecasts({ repo, clock });
  const forecastFailures = forecasts.projects.filter((project) => project.error !== null);
  if (forecastFailures.length > 0) {
    throw new Error(
      `Forecasts failed: ${forecastFailures
        .map((project) => `${project.projectName}: ${project.error}`)
        .join("; ")}`,
    );
  }
  console.log("  forecasts and alerts written");

  const memory = await buildMemory({ repo, clock });
  const memoryFailures = memory.projects.filter((project) => project.error !== null);
  if (memoryFailures.length > 0) {
    throw new Error(
      `Memory failed: ${memoryFailures
        .map((project) => `${project.projectName}: ${project.error}`)
        .join("; ")}`,
    );
  }
  console.log("  memory items written (without embeddings: the Embedder port is pending)");

  console.log("Done. Re-running this script is safe.");
}

main().catch((error: unknown) => {
  console.error(
    `seed:supabase failed: ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exit(1);
});
