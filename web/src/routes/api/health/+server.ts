import { json } from "@sveltejs/kit";
import { db } from "$lib/server/db";

/**
 * Dashboard liveness endpoint for external uptime monitoring.
 *
 * Phase 1.6 of the observability plan. Performs a `SELECT 1` against the
 * read-only SQLite connection to verify the dashboard can reach the bot's
 * shared database. Better Stack pings this URL on a 3-minute interval and
 * treats anything other than HTTP 200 as a downtime incident.
 *
 * Response shape:
 *   { status: 'ok', db: true, version: <git_sha|null>, latencyMs: <ms>, ts: <iso> }
 *   200 OK
 *
 * On DB failure:
 *   { status: 'degraded', db: false, dbError: <msg>, ts: <iso> }
 *   503 Service Unavailable
 */
export async function GET() {
  const startedAt = Date.now();
  let dbOk = false;
  let dbError: string | undefined;

  try {
    const row = db().prepare("SELECT 1 AS ok").get() as { ok?: number } | undefined;
    dbOk = row?.ok === 1;
  } catch (err) {
    dbOk = false;
    dbError = err instanceof Error ? err.message : "unknown_db_error";
  }

  const latencyMs = Date.now() - startedAt;
  const ts = new Date().toISOString();
  const version = process.env.BUILD_GIT_SHA || null;

  if (dbOk) {
    return json({ status: "ok", db: true, version, latencyMs, ts }, { status: 200 });
  }

  return json({ status: "degraded", db: false, dbError, version, latencyMs, ts }, { status: 503 });
}
