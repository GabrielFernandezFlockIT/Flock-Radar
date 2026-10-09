import type { AlertKind, SyncSource } from "@/shared/domain";

/**
 * Error contracts shared by ports and their adapters. Use cases branch on
 * these types, never on adapter-specific errors or message text.
 */

/**
 * A repository rejected a write that Postgres would reject too: a duplicate
 * natural key within one batch, a reference to a missing parent, or a
 * conflicting unique value.
 */
export class RepositoryConstraintError extends Error {
  constructor(
    /** Stable constraint name, e.g. `issues_project_key`. */
    readonly constraint: string,
    message: string,
  ) {
    super(message);
    this.name = "RepositoryConstraintError";
  }
}

/** Changing an alert's status would leave two active alerts of one kind. */
export class AlertConflictError extends RepositoryConstraintError {
  constructor(
    readonly projectId: string,
    readonly kind: AlertKind,
    readonly activeAlertId: string,
  ) {
    super(
      "alerts_active_key",
      `Project ${projectId} already has an active ${kind} alert (${activeAlertId}).`,
    );
    this.name = "AlertConflictError";
  }
}

/** Longest `reason` kept from a source failure. */
const MAX_REASON_LENGTH = 120;

/**
 * A source could not be read. `reason` must be safe to show to project
 * members and to store: short, no URLs, no tokens, no upstream bodies.
 * Adapters translate transport errors into this type, e.g.
 * `new SourceUnavailableError("jira", "unauthorized", { status: 401 })`.
 */
export class SourceUnavailableError extends Error {
  readonly reason: string;
  readonly status: number | undefined;

  constructor(
    readonly source: SyncSource,
    reason: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    const safeReason = sanitizeReason(reason);
    super(`${source}: ${safeReason}`, { cause: options.cause });
    this.name = "SourceUnavailableError";
    this.reason = safeReason;
    this.status = options.status;
  }

  /** The text stored on a sync run, e.g. `jira: HTTP 401 unauthorized`. */
  get publicMessage(): string {
    const status = this.status === undefined ? "" : `HTTP ${this.status} `;
    return `${this.source}: ${status}${this.reason}`;
  }
}

/** Strips URLs and control characters and caps the length. */
function sanitizeReason(reason: string): string {
  const printable = Array.from(reason, (char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 ? " " : char;
  }).join("");
  const cleaned = printable
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[url]")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "unavailable").slice(0, MAX_REASON_LENGTH);
}
