import "server-only";

import { z } from "zod";

/**
 * Server-side environment configuration.
 *
 * - Parsed once per process via `getEnv()`.
 * - `parseEnv()` is pure so it can be unit-tested without touching `process.env`.
 * - Values are trimmed; empty strings (e.g. `FOO=` in a .env file) are treated
 *   as "not set".
 */

const optionalString = z.string().min(1).optional();
// Only http(s) URLs: rejects `javascript:`, `mailto:`, `ftp:`, and scheme-less hosts.
const optionalUrl = z.url({ protocol: /^https?$/ }).optional();

export const CRON_SECRET_MIN_LENGTH = 16;

const LIVE_MODE_REQUIRED_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";
export const DEFAULT_JIRA_STORY_POINTS_FIELD = "customfield_10016";

export const envSchema = z
  .object({
    // Runtime mode
    DEMO_MODE: z.stringbool().default(true),
    NEXT_PUBLIC_APP_URL: optionalUrl,

    // Supabase (required only in live mode)
    NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
    SUPABASE_SERVICE_ROLE_KEY: optionalString,

    // LLM + embeddings
    ANTHROPIC_API_KEY: optionalString,
    ANTHROPIC_MODEL: z.string().min(1).default(DEFAULT_ANTHROPIC_MODEL),
    VOYAGE_API_KEY: optionalString,

    // Jira Cloud
    JIRA_BASE_URL: optionalUrl,
    JIRA_EMAIL: optionalString,
    JIRA_API_TOKEN: optionalString,
    JIRA_STORY_POINTS_FIELD: z
      .string()
      .min(1)
      .default(DEFAULT_JIRA_STORY_POINTS_FIELD),

    // GitHub
    GITHUB_TOKEN: optionalString,

    // Google Calendar (service account)
    GOOGLE_CLIENT_EMAIL: optionalString,
    GOOGLE_PRIVATE_KEY: optionalString.transform((value) =>
      // Hosting dashboards usually store the PEM with escaped newlines.
      value?.replace(/\\n/g, "\n"),
    ),
    GOOGLE_CALENDAR_IDS: optionalString.transform((value) =>
      value
        ? value
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean)
        : [],
    ),

    // Flocktools
    FLOCKTOOLS_BASE_URL: optionalUrl,
    FLOCKTOOLS_API_TOKEN: optionalString,

    // Optional remote MCP connector for chat
    REMOTE_MCP_ENABLED: z.stringbool().default(false),
    REMOTE_MCP_JIRA_URL: optionalUrl,
    REMOTE_MCP_JIRA_TOKEN: optionalString,

    // Vercel Cron
    CRON_SECRET: z
      .string()
      .min(
        CRON_SECRET_MIN_LENGTH,
        `CRON_SECRET must be at least ${CRON_SECRET_MIN_LENGTH} characters (generate one with: openssl rand -hex 32).`,
      )
      .optional(),
  })
  .superRefine((env, ctx) => {
    if (env.DEMO_MODE) return;

    for (const key of LIVE_MODE_REQUIRED_KEYS) {
      if (!env[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required when DEMO_MODE=false (live mode). Set it or enable DEMO_MODE=true.`,
        });
      }
    }
  });

export type Env = z.output<typeof envSchema>;
export type RawEnv = Record<string, string | undefined>;

export class EnvValidationError extends Error {
  constructor(
    readonly issues: z.ZodError["issues"],
    details: string,
  ) {
    super(`Invalid environment configuration:\n${details}`);
    this.name = "EnvValidationError";
  }
}

/** Trims every value and maps blank ones to `undefined`. */
function normalize(raw: RawEnv): RawEnv {
  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => {
      const trimmed = value?.trim();
      return [key, trimmed ? trimmed : undefined];
    }),
  );
}

/** Pure parser: validates a raw env record and returns typed config or throws. */
export function parseEnv(raw: RawEnv): Env {
  const result = envSchema.safeParse(normalize(raw));
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues,
      z.prettifyError(result.error),
    );
  }
  return result.data;
}

let cachedEnv: Env | undefined;

/** Returns the process-wide parsed env. Parsed lazily on first access. */
export function getEnv(): Env {
  cachedEnv ??= parseEnv(process.env);
  return cachedEnv;
}
