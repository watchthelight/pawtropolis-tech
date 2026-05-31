// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * tests/db/migration079.test.ts
 * Verifies migration 079 widens movie_attendance's unique key to include
 * event_type, so a movie and a game on the same calendar day no longer collide.
 */
import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { migrate079MovieAttendanceEventTypeUnique } from "../../migrations/079_movie_attendance_event_type_unique.js";

function makeOldTable(db: InstanceType<typeof Database>): void {
  // Mirror the pre-079 shape (025 + 040 columns), 3-column unique key.
  db.exec(`
    CREATE TABLE movie_attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      event_date TEXT NOT NULL,
      voice_channel_id TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      longest_session_minutes INTEGER NOT NULL,
      qualified INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      event_type TEXT DEFAULT 'movie',
      event_start_time INTEGER,
      event_end_time INTEGER,
      UNIQUE(guild_id, user_id, event_date)
    );
  `);
  db.exec(`
    CREATE TABLE schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT,
      applied_at INTEGER DEFAULT (strftime('%s','now'))
    );
  `);
}

describe("migration 079: movie_attendance event_type unique", () => {
  it("lets a movie and a game on the same day coexist after migration", () => {
    const db = new Database(":memory:");
    makeOldTable(db);

    const insert = db.prepare(`
      INSERT OR REPLACE INTO movie_attendance
        (guild_id, user_id, event_date, voice_channel_id, duration_minutes, longest_session_minutes, qualified, event_type)
      VALUES (?, ?, ?, 'vc', 60, 60, 1, ?)
    `);
    insert.run("g1", "u1", "2026-05-31", "movie");

    migrate079MovieAttendanceEventTypeUnique(db);

    // Adding a game row for the same day must NOT replace the movie row.
    insert.run("g1", "u1", "2026-05-31", "game");

    const rows = db
      .prepare(`SELECT event_type FROM movie_attendance WHERE guild_id='g1' AND user_id='u1' AND event_date='2026-05-31' ORDER BY event_type`)
      .all() as Array<{ event_type: string }>;
    expect(rows.map((r) => r.event_type)).toEqual(["game", "movie"]);

    // Same (guild,user,date,type) still de-dups via the new unique key.
    insert.run("g1", "u1", "2026-05-31", "movie");
    const movieCount = db
      .prepare(`SELECT COUNT(*) c FROM movie_attendance WHERE guild_id='g1' AND user_id='u1' AND event_date='2026-05-31' AND event_type='movie'`)
      .get() as { c: number };
    expect(movieCount.c).toBe(1);

    // Migration recorded itself.
    const rec = db.prepare(`SELECT version FROM schema_migrations WHERE version='079'`).get();
    expect(rec).toBeTruthy();

    db.close();
  });

  it("is idempotent / safe to run twice", () => {
    const db = new Database(":memory:");
    makeOldTable(db);
    migrate079MovieAttendanceEventTypeUnique(db);
    expect(() => migrate079MovieAttendanceEventTypeUnique(db)).not.toThrow();
    db.close();
  });
});
