import { error, type RequestHandler } from "@sveltejs/kit";
import { hasMinTier } from "$lib/server/roles";
import { db } from "$lib/server/db";
import { parseTimeWindowSpec, resolveRange, formatWindowLabel } from "$lib/shared/timeWindow";

/**
 * GET /api/export?type=stats
 *   [&window=7d|30d|90d|all|custom][&from=YYYY-MM-DD&to=YYYY-MM-DD]
 *
 * Streams CSV export for dashboard data. Requires gk tier minimum.
 *
 * Audit and config_audit exports were removed: their queries referenced
 * a non-existent table (audit_results) and a non-existent column
 * (config_audit_log.changed_at_s). They had no UI consumers. See done/00044.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.user || !hasMinTier(locals.user.tier, "gk")) {
    error(403, "Not authorized");
  }

  const type = url.searchParams.get("type");
  const guildId = process.env.GUILD_ID;
  if (!guildId) error(500, "GUILD_ID not set");

  const spec = parseTimeWindowSpec(url.searchParams, "all");
  const range = resolveRange(spec);
  const label = formatWindowLabel(spec)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  let rows: Record<string, unknown>[];
  let filename: string;

  switch (type) {
    case "stats": {
      rows = db()
        .prepare(
          `SELECT
						actor_id as mod_id,
						action,
						app_id,
						created_at_s,
						datetime(created_at_s, 'unixepoch') as created_at_iso
					FROM action_log
					WHERE guild_id = ? AND action IN ('approve', 'reject', 'perm_reject', 'kick', 'claim')
						AND (? = 0 OR created_at_s >= ?)
						AND created_at_s < ?
					ORDER BY created_at_s DESC
					LIMIT 10000`
        )
        .all(guildId, range.startS, range.startS, range.endS) as Record<string, unknown>[];
      filename = `review-actions-${label}.csv`;
      break;
    }
    default:
      error(400, "Invalid export type. Use: stats");
  }

  if (rows.length === 0) {
    error(404, "No data to export");
  }

  const headers = Object.keys(rows[0]);
  const csvLines = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const val = row[h];
          if (val === null || val === undefined) return "";
          const str = String(val);
          return str.includes(",") || str.includes('"') || str.includes("\n")
            ? `"${str.replace(/"/g, '""')}"`
            : str;
        })
        .join(",")
    ),
  ];

  return new Response(csvLines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-cache",
    },
  });
};
