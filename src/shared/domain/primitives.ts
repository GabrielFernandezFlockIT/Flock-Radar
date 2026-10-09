import { z } from "zod";

/**
 * Shared Zod primitives for domain schemas. Pure: no IO, no framework imports.
 *
 * Conventions:
 * - Instants are ISO 8601 datetimes with an explicit offset (`Z` or `+hh:mm`).
 * - Calendar days are ISO dates (`YYYY-MM-DD`) and are interpreted in UTC.
 * - URLs are absolute http(s) URLs; anything else (`javascript:`, `mailto:`)
 *   is rejected so evidence links are always safe to render.
 * - Internal links are root-relative app paths (`/projects/x/statuses/y`).
 *   Protocol-relative (`//evil.test`) and backslash forms are rejected,
 *   because a browser resolves them against another origin.
 */

export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export const IsoDateSchema = z.iso.date();
export const HttpUrlSchema = z.url({ protocol: /^https?$/ });
/**
 * A link INTO this app: a root-relative path. The leading `/` with no second
 * `/` (and no backslash) keeps it on this origin, and the allowed character
 * set excludes everything a scheme would need, so `javascript:...` and
 * `//evil.test` can never match.
 */
export const AppPathSchema = z
  .string()
  .regex(/^\/(?![/\\])[A-Za-z0-9\-._~%/?#[\]@!$&'()*+,;=]*$/);
/** Either an absolute http(s) URL or an internal app path. */
export const LinkSchema = z.union([HttpUrlSchema, AppPathSchema]);
export const UuidSchema = z.uuid();
export const NonEmptyStringSchema = z.string().trim().min(1);
/** Probability or confidence in the closed interval [0, 1]. */
export const UnitIntervalSchema = z.number().min(0).max(1);
export const NonNegativeNumberSchema = z.number().finite().nonnegative();
export const NonNegativeIntSchema = z.number().int().nonnegative();

/** Jira project key, e.g. `BCN`. */
export const ProjectKeySchema = z.string().regex(/^[A-Z][A-Z0-9]+$/);
/** Jira issue key, e.g. `BCN-123`. */
export const IssueKeySchema = z.string().regex(/^[A-Z][A-Z0-9]+-\d+$/);
/**
 * Full 40-character git commit SHA. Adapters always store full SHAs; the
 * abbreviated form (`shortSha`) is only for display and evidence ids.
 */
export const CommitShaSchema = z.string().regex(/^[0-9a-f]{40}$/);
/** GitHub repository in `owner/name` form. */
export const GithubRepoSchema = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
/** ISO 4217 currency code, e.g. `USD`. */
export const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);

export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;
export type IsoDate = z.infer<typeof IsoDateSchema>;
