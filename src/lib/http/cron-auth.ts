import "server-only";

import { getEnv } from "@/shared/config/env";

import { isValidBearerToken } from "./bearer-token";

/**
 * Verifies the `Authorization` header Vercel Cron sends
 * (`Bearer ${CRON_SECRET}`). Reads the secret through a narrow accessor so it
 * never travels through the app container. Fails closed when unset.
 */
export function verifyCronSecret(authorizationHeader: string | null): boolean {
  return isValidBearerToken(authorizationHeader, getEnv().CRON_SECRET);
}
