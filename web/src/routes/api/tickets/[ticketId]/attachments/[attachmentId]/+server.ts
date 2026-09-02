/**
 * Auth-gated streaming proxy for ticket attachments.
 *
 * Path: /api/tickets/[ticketId]/attachments/[attachmentId]
 *
 * Flow: lookup attachment row → validate ticket id matches → validate user has
 *       tier to see this ticket type (reports require 'mod') → resolve
 *       local_path inside data/ticket-attachments/, prevent traversal →
 *       stream bytes with stored mime + private cache header.
 *
 * 404 for missing or unmirrored attachments. The dashboard falls back to the
 * original Discord URL on its side when hasLocalMirror is false.
 */

import { error } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { hasMinTier } from "$lib/server/roles";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import { Readable } from "node:stream";
import type { RequestHandler } from "./$types";

const ATTACHMENTS_ROOT = join(process.cwd(), "data", "ticket-attachments");

export const GET: RequestHandler = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) error(401, "Sign in required");
  if (!hasMinTier(user.tier, "viewer")) error(403, "Staff role required");

  const { ticketId, attachmentId } = params;
  if (!ticketId || !attachmentId) error(404, "Not found");

  const row = db()
    .prepare(
      `SELECT a.id, a.ticket_id, a.filename, a.mime, a.local_path,
			        t.type_key
			   FROM ticket_attachment a
			   JOIN ticket t ON t.id = a.ticket_id
			  WHERE a.id = ? AND a.ticket_id = ?`
    )
    .get(attachmentId, ticketId) as
    | {
        id: string;
        ticket_id: string;
        filename: string;
        mime: string | null;
        local_path: string | null;
        type_key: string;
      }
    | undefined;
  if (!row) error(404, "Attachment not found");

  // Privacy gate per ticket type — Ambassadors can't pull report attachments.
  if (
    (row.type_key === "report-user" || row.type_key === "report-staff") &&
    !hasMinTier(user.tier, "mod")
  ) {
    error(403, "Mod Team role required to view report attachments");
  }

  if (!row.local_path) {
    // Not mirrored — direct the caller back to the original Discord URL by
    // returning 410 Gone instead of 404 so the dashboard can render the
    // "may have expired" warning correctly.
    error(410, "Attachment was not mirrored to local disk");
  }

  // Prevent path traversal: resolve the absolute path and verify it stays
  // under ATTACHMENTS_ROOT. local_path is stored as
  // "ticket-attachments/<ticketId>/<sha256>-<filename>" (relative to data/).
  const fullPath = normalize(join(process.cwd(), "data", row.local_path));
  const safeRoot = normalize(ATTACHMENTS_ROOT) + sep;
  if (!fullPath.startsWith(safeRoot)) {
    error(404, "Bad attachment path");
  }

  // Streamed rather than read into memory: attachments run to tens of megabytes and a
  // few concurrent downloads would otherwise hold all of them in the web process at once.
  let size: number;
  try {
    size = (await stat(fullPath)).size;
  } catch {
    error(404, "File missing on disk");
  }

  const body = Readable.toWeb(createReadStream(fullPath)) as ReadableStream;

  return new Response(body, {
    headers: {
      "Content-Type": row.mime ?? "application/octet-stream",
      "Content-Length": String(size),
      "Content-Disposition": `inline; filename="${encodeURIComponent(row.filename)}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
};
