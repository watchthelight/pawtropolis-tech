/**
 * Pawtropolis Tech -- tests/flag.store.test.ts
 * WHAT: Proves flagsStore CRUD (getExistingFlag, isAlreadyFlagged,
 *       getFlaggedUserIds, upsertManualFlag) against a real in-memory DB.
 * WHY: Flag tracking gates moderation visibility; it had zero coverage because
 *       the module once prepared statements at load time (audit finding 7,
 *       #00047). flagsStore now lazy-initializes statements, so a vi.mock of
 *       the db symbol is intercepted before first use -- no prod change needed.
 * HOW: vi.hoisted creates one in-memory better-sqlite3 (stable across the
 *       module's statement cache); each test resets the user_activity rows.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, vi } from "vitest";

const { testDb } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require("better-sqlite3");
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE user_activity (
      guild_id           TEXT NOT NULL,
      user_id            TEXT NOT NULL,
      joined_at          INTEGER NOT NULL,
      first_message_at   INTEGER,
      flagged_at         INTEGER,
      flagged_reason     TEXT,
      manual_flag        INTEGER DEFAULT 0,
      flagged_by         TEXT,
      left_at            INTEGER,
      PRIMARY KEY (guild_id, user_id)
    );
  `);
  return { testDb: db };
});

vi.mock("../src/db/db.js", () => ({ db: testDb }));
vi.mock("../src/lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { getExistingFlag, isAlreadyFlagged, getFlaggedUserIds, upsertManualFlag } =
  await import("../src/store/flagsStore.js");

beforeEach(() => {
  testDb.exec("DELETE FROM user_activity");
});

/** Insert a raw user_activity row for arranging test state. */
function seed(row: {
  guild_id: string;
  user_id: string;
  joined_at?: number;
  flagged_at?: number | null;
  flagged_reason?: string | null;
  manual_flag?: number;
  flagged_by?: string | null;
}) {
  testDb
    .prepare(
      `INSERT INTO user_activity (guild_id, user_id, joined_at, flagged_at, flagged_reason, manual_flag, flagged_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.guild_id,
      row.user_id,
      row.joined_at ?? 1_600_000_000,
      row.flagged_at ?? null,
      row.flagged_reason ?? null,
      row.manual_flag ?? 0,
      row.flagged_by ?? null
    );
}

describe("flagsStore.getExistingFlag", () => {
  it("returns null when the user has no row", () => {
    expect(getExistingFlag("g1", "u1")).toBeNull();
  });

  it("returns null when a row exists but is not flagged (flagged_at IS NULL)", () => {
    seed({ guild_id: "g1", user_id: "u1", flagged_at: null });
    expect(getExistingFlag("g1", "u1")).toBeNull();
  });

  it("returns the flag row when the user is flagged", () => {
    seed({
      guild_id: "g1",
      user_id: "u1",
      flagged_at: 1_700_000_000,
      flagged_reason: "spam",
      manual_flag: 1,
      flagged_by: "mod1",
    });
    const row = getExistingFlag("g1", "u1");
    expect(row).toMatchObject({
      guild_id: "g1",
      user_id: "u1",
      flagged_at: 1_700_000_000,
      flagged_reason: "spam",
      manual_flag: 1,
      flagged_by: "mod1",
    });
  });

  it("scopes by guild and user", () => {
    seed({ guild_id: "g1", user_id: "u1", flagged_at: 1 });
    expect(getExistingFlag("g2", "u1")).toBeNull();
    expect(getExistingFlag("g1", "u2")).toBeNull();
  });
});

describe("flagsStore.isAlreadyFlagged", () => {
  it("is false for an unflagged user", () => {
    seed({ guild_id: "g1", user_id: "u1", flagged_at: null });
    expect(isAlreadyFlagged("g1", "u1")).toBe(false);
  });

  it("is true for a flagged user", () => {
    seed({ guild_id: "g1", user_id: "u1", flagged_at: 1_700_000_000 });
    expect(isAlreadyFlagged("g1", "u1")).toBe(true);
  });
});

describe("flagsStore.getFlaggedUserIds", () => {
  it("returns only flagged users for the given guild", () => {
    seed({ guild_id: "g1", user_id: "flagged1", flagged_at: 1 });
    seed({ guild_id: "g1", user_id: "flagged2", flagged_at: 2 });
    seed({ guild_id: "g1", user_id: "clean", flagged_at: null });
    seed({ guild_id: "g2", user_id: "otherGuild", flagged_at: 3 });

    const ids = getFlaggedUserIds("g1").sort();
    expect(ids).toEqual(["flagged1", "flagged2"]);
  });

  it("returns an empty array when no users are flagged", () => {
    seed({ guild_id: "g1", user_id: "clean", flagged_at: null });
    expect(getFlaggedUserIds("g1")).toEqual([]);
  });
});

describe("flagsStore.upsertManualFlag", () => {
  it("inserts a new row with manual_flag = 1 and the moderator id", () => {
    const before = Math.floor(Date.now() / 1000);
    const row = upsertManualFlag({
      guildId: "g1",
      userId: "u1",
      reason: "suspicious",
      flaggedBy: "mod1",
      joinedAt: 1_640_000_000,
    });
    expect(row).toMatchObject({
      guild_id: "g1",
      user_id: "u1",
      flagged_reason: "suspicious",
      manual_flag: 1,
      flagged_by: "mod1",
      joined_at: 1_640_000_000,
    });
    expect(row.flagged_at).toBeGreaterThanOrEqual(before);
  });

  it("defaults joined_at to now when not provided on insert", () => {
    const before = Math.floor(Date.now() / 1000);
    const row = upsertManualFlag({ guildId: "g1", userId: "u1", reason: "x", flaggedBy: "mod1" });
    expect(row.joined_at).toBeGreaterThanOrEqual(before);
  });

  it("updates an existing row without changing its joined_at", () => {
    seed({ guild_id: "g1", user_id: "u1", joined_at: 111, flagged_at: null });
    const row = upsertManualFlag({
      guildId: "g1",
      userId: "u1",
      reason: "now flagged",
      flaggedBy: "mod2",
    });
    expect(row).toMatchObject({
      guild_id: "g1",
      user_id: "u1",
      joined_at: 111,
      flagged_reason: "now flagged",
      manual_flag: 1,
      flagged_by: "mod2",
    });
    // Still a single row (UPDATE, not duplicate INSERT).
    const count = testDb
      .prepare("SELECT COUNT(*) c FROM user_activity WHERE guild_id = ? AND user_id = ?")
      .get("g1", "u1") as { c: number };
    expect(count.c).toBe(1);
  });

  it("overwrites an existing auto-flag with the manual flag", () => {
    seed({
      guild_id: "g1",
      user_id: "u1",
      flagged_at: 1,
      flagged_reason: "auto: edge score",
      manual_flag: 0,
      flagged_by: null,
    });
    const row = upsertManualFlag({ guildId: "g1", userId: "u1", reason: "mod override", flaggedBy: "mod1" });
    expect(row.manual_flag).toBe(1);
    expect(row.flagged_reason).toBe("mod override");
    expect(row.flagged_by).toBe("mod1");
  });

  it("trims and truncates the reason to 512 characters", () => {
    const row = upsertManualFlag({
      guildId: "g1",
      userId: "u1",
      reason: "   " + "a".repeat(600) + "   ",
      flaggedBy: "mod1",
    });
    expect(row.flagged_reason).toHaveLength(512);
    expect(row.flagged_reason).toBe("a".repeat(512));
  });
});
