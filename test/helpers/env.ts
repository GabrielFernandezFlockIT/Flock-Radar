import { vi } from "vitest";

import { envSchema } from "@/shared/config/env";

/**
 * Replaces every variable the app reads with `values` (others become unset),
 * so tests never depend on the ambient shell environment.
 * Restored automatically by `unstubEnvs: true` in vitest.config.mts.
 */
export function stubIsolatedEnv(values: Record<string, string>): void {
  for (const key of Object.keys(envSchema.shape)) {
    vi.stubEnv(key, undefined);
  }
  for (const [key, value] of Object.entries(values)) {
    vi.stubEnv(key, value);
  }
}
