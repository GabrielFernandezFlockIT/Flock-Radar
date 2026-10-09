import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client (live mode).
 *
 * SERVER ONLY. The service role bypasses Row Level Security, so this module
 * must never reach the client bundle:
 * - it is imported only by `src/adapters/supabase/*` and `scripts/*`;
 * - the key comes from `SUPABASE_SERVICE_ROLE_KEY`, which has no
 *   `NEXT_PUBLIC_` prefix, so Next.js refuses to inline it in a Client
 *   Component;
 * - the composition root (`import "server-only"`) is the only app-side module
 *   that constructs it.
 *
 * `server-only` itself is deliberately NOT imported here: `scripts/seed-supabase.ts`
 * runs this code under plain Node (tsx), where that package throws by design.
 *
 * Configured for a stateless backend: no session persistence, no refresh
 * timers, no storage — one long-lived client per process is enough.
 */

export interface SupabaseServiceConfig {
  /** `NEXT_PUBLIC_SUPABASE_URL`, e.g. `https://abc.supabase.co`. */
  url: string;
  /** `SUPABASE_SERVICE_ROLE_KEY`. Never logged, never returned. */
  serviceRoleKey: string;
}

/** The subset of the SDK the repository uses; keeps call sites untyped-safe. */
export type SupabaseServiceClient = SupabaseClient;

export function createServiceRoleClient(
  config: SupabaseServiceConfig,
): SupabaseServiceClient {
  if (!config.url || !config.serviceRoleKey) {
    throw new Error(
      "Supabase live mode needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    db: { schema: "public" },
    global: { headers: { "X-Client-Info": "flock-radar/service-role" } },
  });
}
