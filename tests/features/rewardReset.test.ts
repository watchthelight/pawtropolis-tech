// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * tests/features/rewardReset.test.ts
 * WHAT: Clearing one member's reward bookkeeping.
 * WHY: /resetprofile is aimed at a single person by hand. Reaching one row too far
 *      wipes real earned rewards, so the scoping is the whole point of the test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";

const holder = vi.hoisted(() => ({ db: null as unknown as InstanceType<typeof Database> }));

vi.mock("../../src/db/db.js", () => ({
  db: {
    prepare: (sql: string) => holder.db.prepare(sql),
    transaction: (fn: (...args: unknown[]) => unknown) => holder.db.transaction(fn),
  },
}));

import { resetMemberRewardState, totalRowsCleared } from "../../src/features/rewardReset.js";

const G = "guild1";
const OTHER_GUILD = "guild2";
const U = "taylor";
const OTHER_USER = "someone-else";

function seed(guildId: string, userId: string): void {
  holder.db
    .prepare(`INSERT INTO level_reward_granted (guild_id, user_id, level) VALUES (?, ?, 100)`)
    .run(guildId, userId);
  holder.db
    .prepare(
      `INSERT INTO inventory_items (guild_id, user_id, item_key, quantity) VALUES (?, ?, 'byte:rare', 2)`
    )
    .run(guildId, userId);
  holder.db
    .prepare(
      `INSERT INTO inventory_log (guild_id, user_id, item_key, delta, source) VALUES (?, ?, 'byte:rare', 1, 'byte')`
    )
    .run(guildId, userId);
  holder.db
    .prepare(
      `INSERT INTO inventory_grant_keys (guild_id, user_id, grant_key) VALUES (?, ?, 'mimu:123')`
    )
    .run(guildId, userId);
  holder.db
    .prepare(
      `INSERT INTO pending_item_capture (guild_id, user_id, role_id, item_key, remove_at_s) VALUES (?, ?, 'role1', 'byte:rare', 0)`
    )
    .run(guildId, userId);
}

function rowCount(table: string, guildId: string, userId: string): number {
  return (
    holder.db
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE guild_id = ? AND user_id = ?`)
      .get(guildId, userId) as { n: number }
  ).n;
}

const TABLES = [
  "level_reward_granted",
  "inventory_items",
  "inventory_log",
  "inventory_grant_keys",
  "pending_item_capture",
];

beforeEach(() => {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE level_reward_granted (
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, level INTEGER NOT NULL,
      granted_at_s INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(guild_id, user_id, level)
    );
    CREATE TABLE inventory_items (
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, item_key TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      updated_at_s INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(guild_id, user_id, item_key)
    );
    CREATE TABLE inventory_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, item_key TEXT NOT NULL,
      delta INTEGER NOT NULL, source TEXT NOT NULL, actor_id TEXT, reason TEXT,
      created_at_s INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE inventory_grant_keys (
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, grant_key TEXT NOT NULL,
      created_at_s INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(guild_id, user_id, grant_key)
    );
    CREATE TABLE pending_item_capture (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL,
      item_key TEXT NOT NULL, grant_key TEXT,
      detected_at_s INTEGER NOT NULL DEFAULT (unixepoch()),
      remove_at_s INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      UNIQUE(guild_id, user_id, role_id)
    );
  `);
  holder.db = d;
});

describe("resetMemberRewardState", () => {
  it("clears every reward table for the target", () => {
    seed(G, U);

    const counts = resetMemberRewardState(G, U);

    for (const table of TABLES) {
      expect(rowCount(table, G, U)).toBe(0);
    }
    expect(counts).toEqual({
      levelRewards: 1,
      items: 1,
      log: 1,
      grantKeys: 1,
      pendingCaptures: 1,
    });
    expect(totalRowsCleared(counts)).toBe(5);
  });

  it("REGRESSION: leaves other members untouched", () => {
    seed(G, U);
    seed(G, OTHER_USER);

    resetMemberRewardState(G, U);

    for (const table of TABLES) {
      expect(rowCount(table, G, OTHER_USER)).toBe(1);
    }
  });

  it("REGRESSION: leaves the same member in another guild untouched", () => {
    seed(G, U);
    seed(OTHER_GUILD, U);

    resetMemberRewardState(G, U);

    for (const table of TABLES) {
      expect(rowCount(table, OTHER_GUILD, U)).toBe(1);
    }
  });

  it("reports zeroes for a member who has earned nothing", () => {
    const counts = resetMemberRewardState(G, "stranger");

    expect(totalRowsCleared(counts)).toBe(0);
  });

  it("lets a level reward fire again after the marker is gone", () => {
    seed(G, U);
    const claim = () =>
      holder.db
        .prepare(`INSERT OR IGNORE INTO level_reward_granted (guild_id, user_id, level) VALUES (?, ?, 100)`)
        .run(G, U).changes;

    expect(claim()).toBe(0);
    resetMemberRewardState(G, U);
    expect(claim()).toBe(1);
  });
});
