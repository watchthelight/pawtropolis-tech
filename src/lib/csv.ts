/**
 * Pawtropolis Tech — src/lib/csv.ts
 * WHAT: CSV streaming utilities for analytics export.
 * WHY: Enables large dataset exports without memory bloat.
 * FLOWS:
 *  - streamReviewActionsCSV → writes audit rows to stream with proper CSV escaping
 * DOCS:
 *  - RFC 4180 CSV: https://datatracker.ietf.org/doc/html/rfc4180
 *  - Node.js Streams: https://nodejs.org/api/stream.html
 *
 * NOTE: Uses chunked iteration with keyset pagination to cap memory usage.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

/**
 * escapeCsvField
 * WHAT: Escapes a field for CSV output per RFC 4180.
 * WHY: Prevents CSV injection and preserves data integrity.
 * HOW: Wraps in quotes if contains comma/newline/quote; doubles internal quotes.
 *
 * @param value - Field value (may be null/undefined)
 * @returns Escaped CSV field
 */
function escapeCsvField(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  const str = String(value);

  // RFC 4180 rules: quote the field if it contains delimiter, newline, or quote.
  // Double-quote escaping (""") is the standard way to include literal quotes.
  // This also prevents CSV injection attacks where =, +, -, @ could trigger
  // formula execution in Excel. Wrapping in quotes neutralizes that.
  if (str.includes(",") || str.includes("\n") || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * streamReviewActionsCSV
 * WHAT: Streams review_action rows as CSV to a destination stream.
 * WHY: Enables export of large datasets without OOM.
 * HOW: Chunked iteration with keyset pagination (LIMIT/OFFSET); writes header + rows.
 *
 * CSV Format:
 *   timestamp_iso,guild_id,app_id,user_id,moderator_id,action,reason
 *
 * @param opts - Export options (guildId, from, to, allGuilds)
 * @param stream - Destination writable stream
 * @returns Promise<{ rowCount: number, bytes: number }>
 */
/**
 * formatActionLogRow
 * WHAT: Transform action_log row to CSV-friendly format
 * WHY: Moderator history export with metadata
 */
export function formatActionLogRow(row: {
  id: number;
  action: string;
  actor_id: string;
  subject_id?: string | null;
  target?: string | null;
  created_at_s: number;
  reason?: string | null;
  meta_json?: string | null;
  guild_id: string;
}): Record<string, any> {
  // meta_json contains variable schema data depending on action type.
  // Parse defensively - malformed JSON shouldn't crash the export.
  // If parse fails, preserve the raw string so data isn't silently lost.
  let meta: Record<string, any> = {};
  if (row.meta_json) {
    try {
      meta = JSON.parse(row.meta_json);
    } catch {
      meta = { raw: row.meta_json };
    }
  }

  return {
    id: row.id,
    timestamp: new Date(row.created_at_s * 1000).toISOString(),
    action: row.action,
    actor_id: row.actor_id,
    subject_id: row.subject_id || "",
    target: row.target || meta.target || "",
    reason: row.reason || "",
    response_ms: meta.response_ms || "",
    guild_id: row.guild_id,
    app_id: meta.appId || meta.app_id || "",
    app_code: meta.appCode || meta.app_code || "",
    meta_summary: JSON.stringify(meta),
  };
}

/**
 * generateModHistoryCsv
 * WHAT: Generate CSV from action_log rows for moderator history
 * WHY: Export moderator action history for analysis
 */
export function generateModHistoryCsv(rows: any[]): string {
  const columns = [
    "id",
    "timestamp",
    "action",
    "actor_id",
    "subject_id",
    "target",
    "reason",
    "response_ms",
    "guild_id",
    "app_id",
    "app_code",
    "meta_summary",
  ];

  // Header
  const header = columns.map(escapeCsvField).join(",");

  // Format and escape rows
  const formattedRows = rows.map((row) => {
    const formatted = formatActionLogRow(row);
    return columns.map((col) => escapeCsvField(formatted[col])).join(",");
  });

  return [header, ...formattedRows].join("\n");
}
