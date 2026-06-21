/**
 * Pawtropolis Tech — tests/features/artJobs/reassign.test.ts
 * WHAT: Regression test for `/art reassign` (reassignJob) against a real
 *       in-memory SQLite database.
 * WHY: The reassign transaction once called insertJobStmt.run() with 7 args for
 *      an 8-placeholder INSERT, so better-sqlite3 threw "Too few parameter
 *      values were provided" and every reassign failed (see the Command Failed
 *      card). A mocked db can't catch a parameter-count mismatch; only a real
 *      prepared statement validates the bind count. So this file mocks db.js
 *      with a genuine better-sqlite3 instance seeded with the art_job schema.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi } from "vitest";

// Real in-memory DB created in the hoisted mock factory so the table exists
// before store.ts prepares its statements at import time.
const { realDb } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require("better-sqlite3");
  const realDb = new Database(":memory:");
  realDb.exec(`
    CREATE TABLE art_job (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      job_number INTEGER NOT NULL,
      artist_id TEXT NOT NULL,
      artist_job_number INTEGER NOT NULL,
      recipient_id TEXT NOT NULL,
      ticket_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'assigned',
      assigned_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      notes TEXT,
      assignment_log_id INTEGER,
      ticket_id TEXT,
      thumbnail_url TEXT,
      UNIQUE(guild_id, job_number)
    );
  `);
  return { realDb };
});

vi.mock("../../../src/db/db.js", () => ({ db: realDb }));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  createJob,
  getJobById,
  getJobByNumber,
  reassignJob,
} from "../../../src/features/artJobs/store.js";

const GUILD = "guild-1";

describe("artJobs/store reassignJob", () => {
  it("cancels the old job and creates a new one for the new artist (no param error)", () => {
    const created = createJob({
      guildId: GUILD,
      artistId: "artist-old",
      recipientId: "recip-1",
      ticketType: "fullbody",
    });

    const oldJob = getJobByNumber(GUILD, created.jobNumber)!;
    expect(oldJob).toBeTruthy();

    // The actual regression: this threw "Too few parameter values were
    // provided" before the ticket_id arg was added to the INSERT.
    const result = reassignJob(oldJob, "artist-new");

    // Old job is cancelled, not deleted.
    const cancelled = getJobById(oldJob.id)!;
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.notes).toContain("artist-new");

    // New job belongs to the new artist and carries the same recipient/type.
    const newJob = getJobById(result.newJob.id)!;
    expect(newJob.artist_id).toBe("artist-new");
    expect(newJob.recipient_id).toBe("recip-1");
    expect(newJob.ticket_type).toBe("fullbody");
    expect(newJob.status).toBe("assigned");
    expect(newJob.ticket_id).toBeNull();
    expect(newJob.notes).toContain(String(oldJob.job_number).padStart(4, "0"));

    // Job numbers advance monotonically; artist-new starts at #1.
    expect(result.newJob.jobNumber).toBe(oldJob.job_number + 1);
    expect(result.newJob.artistJobNumber).toBe(1);
  });
});
