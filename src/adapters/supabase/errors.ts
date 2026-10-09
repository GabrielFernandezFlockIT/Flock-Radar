import { RepositoryConstraintError } from "@/shared/ports";

/**
 * Translates PostgREST/Postgres failures into the port's error contract.
 *
 * Only the SQLSTATE code and the constraint name travel into the message:
 * never the connection string, the keys, the row payload, or the raw upstream
 * body. Use cases branch on `RepositoryConstraintError`, never on text.
 */

interface SupabaseError {
  code?: string | null;
  message?: string | null;
}

/** Postgres integrity violations the port models as constraint errors. */
const CONSTRAINT_CODES: Record<string, string> = {
  "23505": "a unique constraint",
  "23503": "a foreign key",
  "23502": "a not-null constraint",
  "23514": "a check constraint",
  "23P01": "an exclusion constraint",
  // "ON CONFLICT DO UPDATE command cannot affect row a second time".
  "21000": "a duplicate natural key inside one batch",
};

function isSupabaseError(value: unknown): value is SupabaseError {
  return typeof value === "object" && value !== null;
}

/** `... violates unique constraint "issues_project_key"` -> the quoted name. */
export function constraintNameOf(message: string | null | undefined): string | null {
  const match = /constraint "([A-Za-z0-9_]+)"/.exec(message ?? "");
  return match?.[1] ?? null;
}

/**
 * Never returns: always throws the translated error.
 *
 * @param table logical table the operation touched
 * @param operation short verb, e.g. `select`, `upsert`
 */
export function throwTranslated(
  table: string,
  operation: string,
  error: unknown,
): never {
  if (!isSupabaseError(error)) {
    throw new Error(`${table}: ${operation} failed.`);
  }

  const code = error.code ?? "";
  const constraint = constraintNameOf(error.message);
  const kind = CONSTRAINT_CODES[code];

  if (kind !== undefined) {
    throw new RepositoryConstraintError(
      constraint ?? `${table}_constraint`,
      `${table}: ${operation} violates ${kind}${
        constraint === null ? "" : ` (${constraint})`
      }.`,
    );
  }

  // Transport, auth, or anything unmodelled: the code is enough to debug and
  // safe to surface; the upstream message is not.
  throw new Error(
    `${table}: ${operation} failed${code === "" ? "" : ` (Postgres ${code})`}.`,
  );
}

/** Unwraps a PostgREST result, translating its error. */
export function unwrap<T>(
  table: string,
  operation: string,
  result: { data: T | null; error: unknown },
): T {
  if (result.error) throwTranslated(table, operation, result.error);
  if (result.data === null) {
    throw new Error(`${table}: ${operation} returned no data.`);
  }
  return result.data;
}
