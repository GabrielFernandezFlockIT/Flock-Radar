import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

const BEARER_PREFIX = /^Bearer\s+/i;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Checks an `Authorization: Bearer <token>` header against the expected secret
 * in constant time. Both sides are hashed first so lengths never leak.
 * An unset or empty expected secret always fails closed.
 */
export function isValidBearerToken(
  authorizationHeader: string | null,
  expectedSecret: string | undefined,
): boolean {
  if (!expectedSecret || !authorizationHeader) return false;
  if (!BEARER_PREFIX.test(authorizationHeader)) return false;

  const presented = authorizationHeader.replace(BEARER_PREFIX, "").trim();
  if (!presented) return false;

  return timingSafeEqual(digest(presented), digest(expectedSecret));
}
