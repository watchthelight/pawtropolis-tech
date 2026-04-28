/**
 * Pawtropolis Tech -- src/features/tickets/attachments.ts
 * WHAT: Background mirror that downloads Discord attachments referenced by
 *       ticket_attachment rows (local_path IS NULL) and stores them under
 *       data/ticket-attachments/<ticket_id>/<sha256>-<filename>.
 * WHY: Discord CDN URLs expire (~24h). Without a mirror, transcripts viewed
 *      later show broken images. We capture once into our own filesystem and
 *      serve via the dashboard's auth-gated proxy.
 *
 * QUEUE SHAPE: A simple in-memory queue (FIFO) drained by a single worker.
 * captureMessage (transcript.ts) calls enqueuePending() once per attachment
 * insert. The worker downloads with up to 3 retries (exponential backoff),
 * computes sha256 on-the-fly, writes to disk, and updates the row.
 *
 * QUOTA: Configurable via TICKET_ATTACHMENT_QUOTA_BYTES env var (default 5GB).
 * Running usage is tracked in-memory; soft-warn at 80%, hard-skip new
 * downloads at 95%. Skipped rows keep local_path=NULL — dashboard falls back
 * to the (likely-expired) Discord URL with a "may have expired" indicator.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";

const ATTACHMENTS_DIR = join(process.cwd(), "data", "ticket-attachments");
const DEFAULT_QUOTA_BYTES = 5 * 1024 * 1024 * 1024; // 5 GiB
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

const quotaBytes = (() => {
  const raw = process.env.TICKET_ATTACHMENT_QUOTA_BYTES?.trim();
  if (!raw) return DEFAULT_QUOTA_BYTES;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_QUOTA_BYTES;
})();

const usedSizeStmt = db.prepare(
  `SELECT COALESCE(SUM(size_bytes), 0) AS total
     FROM ticket_attachment
    WHERE local_path IS NOT NULL`
);

const updateAttachmentStmt = db.prepare(
  `UPDATE ticket_attachment
      SET local_path = ?,
          sha256     = ?
    WHERE id = ?`
);

const findPendingStmt = db.prepare(
  `SELECT id, ticket_id, filename, mime, size_bytes, original_url
     FROM ticket_attachment
    WHERE local_path IS NULL
    ORDER BY created_at
    LIMIT 50`
);

interface PendingItem {
  id: string;
  ticketId: string;
  filename: string;
  size: number;
  url: string;
}

const queue: PendingItem[] = [];
const inFlight = new Set<string>();
let workerActive = false;
let usedBytes = 0;
let usedBytesPrimed = false;

function primeUsedBytes(): void {
  if (usedBytesPrimed) return;
  try {
    const row = usedSizeStmt.get() as { total: number } | undefined;
    usedBytes = row?.total ?? 0;
    usedBytesPrimed = true;
    logger.info(
      { usedBytes, quotaBytes },
      "[tickets/attachments] mirror startup usage"
    );
  } catch (err) {
    logger.warn({ err }, "[tickets/attachments] failed to prime used-bytes counter");
  }
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}

/**
 * Add a ticket_attachment row to the in-memory mirror queue. Idempotent: rows
 * already in flight or queued are not duplicated.
 */
export function enqueuePending(row: {
  id: string;
  ticketId: string;
  filename: string;
  size: number;
  url: string;
}): void {
  if (inFlight.has(row.id)) return;
  if (queue.some((q) => q.id === row.id)) return;
  queue.push(row);
  if (!workerActive) {
    void runWorker();
  }
}

/**
 * On startup, scan the table for pending rows (e.g., from a prior bot run that
 * crashed mid-download) and enqueue them. Called once from src/index.ts after
 * client ready.
 */
export function backfillPendingFromDb(): void {
  primeUsedBytes();
  const rows = findPendingStmt.all() as Array<{
    id: string;
    ticket_id: string;
    filename: string;
    size_bytes: number;
    original_url: string;
  }>;
  for (const r of rows) {
    enqueuePending({
      id: r.id,
      ticketId: r.ticket_id,
      filename: r.filename,
      size: r.size_bytes,
      url: r.original_url,
    });
  }
  if (rows.length > 0) {
    logger.info({ count: rows.length }, "[tickets/attachments] enqueued pending mirrors at startup");
  }
}

async function runWorker(): Promise<void> {
  if (workerActive) return;
  workerActive = true;
  primeUsedBytes();
  try {
    while (queue.length > 0) {
      const item = queue.shift()!;
      if (inFlight.has(item.id)) continue;
      inFlight.add(item.id);
      try {
        await mirrorOne(item);
      } catch (err) {
        logger.error(
          { err, attachmentId: item.id },
          "[tickets/attachments] unhandled mirror failure"
        );
      } finally {
        inFlight.delete(item.id);
      }
    }
  } finally {
    workerActive = false;
  }
}

async function mirrorOne(item: PendingItem): Promise<void> {
  // Quota guard
  const projected = usedBytes + item.size;
  if (projected > quotaBytes * 0.95) {
    logger.warn(
      {
        attachmentId: item.id,
        projected,
        quotaBytes,
      },
      "[tickets/attachments] hard-skip — quota >= 95%"
    );
    return; // local_path stays NULL
  }
  if (projected > quotaBytes * 0.8) {
    logger.warn(
      { projected, quotaBytes },
      "[tickets/attachments] soft-warn — quota >= 80%"
    );
  }

  const ticketDir = join(ATTACHMENTS_DIR, item.ticketId);
  mkdirSync(ticketDir, { recursive: true });

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    attempt++;
    try {
      const buf = await fetchToBuffer(item.url);
      const sha256 = createHash("sha256").update(buf).digest("hex");
      const filename = `${sha256}-${safeFilename(item.filename)}`;
      const fullPath = join(ticketDir, filename);
      writeFileSync(fullPath, buf);
      const relPath = join("ticket-attachments", item.ticketId, filename).replace(/\\/g, "/");
      updateAttachmentStmt.run(relPath, sha256, item.id);
      usedBytes += buf.length;
      logger.info(
        { attachmentId: item.id, size: buf.length, path: relPath },
        "[tickets/attachments] mirrored"
      );
      return;
    } catch (err) {
      logger.warn(
        { err, attachmentId: item.id, attempt },
        "[tickets/attachments] download attempt failed"
      );
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
      }
    }
  }
  logger.error(
    { attachmentId: item.id, attempts: MAX_RETRIES },
    "[tickets/attachments] giving up — row stays unmirrored (local_path NULL)"
  );
}

async function fetchToBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetch ${url} failed: HTTP ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}
