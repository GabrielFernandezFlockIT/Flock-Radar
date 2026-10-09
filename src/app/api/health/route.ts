import { connection } from "next/server";

import { getContainer } from "@/composition-root";

/**
 * Liveness probe. Never returns secrets: only the runtime mode, the model id,
 * and — in live mode — whether the database answered. Resolving the container
 * also proves the app booted (in demo mode, that the seeded scenario synced);
 * a boot failure surfaces here as a 500.
 *
 * `connection()` opts this handler out of build-time prerendering (Cache
 * Components replaces the `dynamic = "force-dynamic"` segment config).
 */
/** How long the live-mode database probe may take before it counts as down. */
const DATABASE_PROBE_TIMEOUT_MS = 3000;

export async function GET() {
  await connection();

  const { mode, model, repo } = await getContainer();

  // Cheapest round-trip that proves the connection and the schema: listing
  // projects hits `public.projects` with the configured credentials. The
  // reason is deliberately coarse — no host, no code, no upstream text. A
  // probe must never outlive its own usefulness, so a stalled connection
  // counts as unreachable rather than hanging the request.
  let database: "ok" | "unreachable" | undefined;
  if (mode === "live") {
    database = await Promise.race([
      repo.projects.list().then(
        () => "ok" as const,
        () => "unreachable" as const,
      ),
      new Promise<"unreachable">((resolve) => {
        const timer = setTimeout(
          () => resolve("unreachable"),
          DATABASE_PROBE_TIMEOUT_MS,
        ) as unknown as { unref?: () => void };
        // Node: never hold the process open just for the probe's deadline.
        timer.unref?.();
      }),
    ]);
  }

  return Response.json(
    { status: database === "unreachable" ? "degraded" : "ok", mode, model, database },
    {
      status: database === "unreachable" ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
