import { verifyCronSecret } from "@/lib/http/cron-auth";

/**
 * Vercel Cron entry point (see vercel.json). Vercel sends
 * `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is configured.
 *
 * Reading request headers makes this handler request-time only, so no
 * segment config is needed under Cache Components.
 */
export async function GET(request: Request) {
  if (!verifyCronSecret(request.headers.get("authorization"))) {
    return Response.json(
      { error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    { status: "noop", reason: "sync implemented in phase 9" },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}
