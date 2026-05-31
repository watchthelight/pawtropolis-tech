// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * tests/features/artistRotation/claimNextArtist.test.ts
 * WHAT: Real-DB tests for claimNextArtist - the atomic select-next + rotate that
 *       replaces the command-time getNextArtist baked into the confirm button.
 * WHY: Two non-override redemptions confirmed back to back used to assign the SAME
 *      stale artist twice (#00075). Claiming inside one transaction must hand out a
 *      distinct turn per call.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";

const holder = vi.hoisted(() => ({ db: null as unknown as InstanceType<typeof Database> }));

vi.mock("../../../src/db/db.js", () => ({
  db: {
    prepare: (sql: string) => holder.db.prepare(sql),
    transaction: (fn: (...a: unknown[]) => unknown) => holder.db.transaction(fn),
  },
}));
vi.mock("../../../src/lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

type QueueModule = typeof import("../../../src/features/artistRotation/queue.js");
let claimNextArtist: QueueModule["claimNextArtist"];
let addArtist: QueueModule["addArtist"];
let getAllArtists: QueueModule["getAllArtists"];
let skipArtist: QueueModule["skipArtist"];

const G = "guild-1";

beforeAll(async () => {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE artist_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      added_at TEXT DEFAULT (datetime('now')),
      assignments_count INTEGER DEFAULT 0,
      last_assigned_at TEXT,
      skipped INTEGER DEFAULT 0,
      skip_reason TEXT,
      UNIQUE(guild_id, user_id)
    );
    CREATE TABLE artist_assignment_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      artist_id TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      ticket_type TEXT NOT NULL,
      ticket_role_id TEXT,
      assigned_by TEXT NOT NULL,
      assigned_at TEXT DEFAULT (datetime('now')),
      channel_id TEXT,
      override INTEGER DEFAULT 0
    );
  `);
  holder.db = d;
  // Module-level prepared statements compile against the seeded in-memory db.
  const mod = await import("../../../src/features/artistRotation/queue.js");
  claimNextArtist = mod.claimNextArtist;
  addArtist = mod.addArtist;
  getAllArtists = mod.getAllArtists;
  skipArtist = mod.skipArtist;
});

beforeEach(() => {
  holder.db.prepare(`DELETE FROM artist_queue`).run();
});

describe("claimNextArtist", () => {
  it("returns null on an empty queue", () => {
    expect(claimNextArtist(G)).toBeNull();
  });

  it("two sequential claims hand out DISTINCT artists (the #00075 race)", () => {
    addArtist(G, "artistA"); // position 1
    addArtist(G, "artistB"); // position 2
    addArtist(G, "artistC"); // position 3

    const first = claimNextArtist(G);
    const second = claimNextArtist(G);

    expect(first?.userId).toBe("artistA");
    expect(second?.userId).toBe("artistB"); // NOT artistA again
    expect(first?.userId).not.toBe(second?.userId);
  });

  it("rotates the claimed artist to the end and increments their count", () => {
    addArtist(G, "artistA");
    addArtist(G, "artistB");

    const claim = claimNextArtist(G);
    expect(claim?.userId).toBe("artistA");
    expect(claim?.assignmentsCount).toBe(1);

    const order = getAllArtists(G).map((a) => a.user_id);
    expect(order).toEqual(["artistB", "artistA"]); // A moved to the end
    const a = getAllArtists(G).find((x) => x.user_id === "artistA")!;
    expect(a.assignments_count).toBe(1);
  });

  it("skips artists on break", () => {
    addArtist(G, "artistA");
    addArtist(G, "artistB");
    skipArtist(G, "artistA", "on break");

    const claim = claimNextArtist(G);
    expect(claim?.userId).toBe("artistB"); // A is skipped
  });

  it("a single-artist queue can be claimed repeatedly without error", () => {
    addArtist(G, "solo");
    expect(claimNextArtist(G)?.userId).toBe("solo");
    expect(claimNextArtist(G)?.userId).toBe("solo");
    const solo = getAllArtists(G).find((x) => x.user_id === "solo")!;
    expect(solo.assignments_count).toBe(2);
  });
});
