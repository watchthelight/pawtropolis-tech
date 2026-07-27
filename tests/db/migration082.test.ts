// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * tests/db/migration082.test.ts
 * Verifies migration 082 adds level_reward_dm_enabled to guild_config and that
 * the DM gate respects the toggle. Backs the leveling reward DM opt-out.
 */
import { describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { migrate082LevelRewardDmToggle } from "../../migrations/082_level_reward_dm_toggle.js";
import { levelRewardDmEnabled } from "../../src/features/levelRewardDmPref.js";

function freshDb(): InstanceType<typeof Database> {
  const d = new Database(":memory:");
  d.exec(`CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, name TEXT, applied_at INTEGER DEFAULT (strftime('%s','now')));`);
  d.exec(`CREATE TABLE guild_config (guild_id TEXT PRIMARY KEY);`);
  return d;
}

describe("migration 082: level_reward_dm_enabled", () => {
  it("adds level_reward_dm_enabled defaulting to 1", () => {
    const d = freshDb();
    migrate082LevelRewardDmToggle(d);

    d.prepare(`INSERT INTO guild_config (guild_id) VALUES ('g')`).run();
    const row = d.prepare(`SELECT level_reward_dm_enabled FROM guild_config WHERE guild_id='g'`).get() as { level_reward_dm_enabled: number };
    expect(row.level_reward_dm_enabled).toBe(1);
    d.close();
  });

  it("is idempotent / safe to run twice", () => {
    const d = freshDb();
    migrate082LevelRewardDmToggle(d);
    expect(() => migrate082LevelRewardDmToggle(d)).not.toThrow();
    expect(d.prepare(`SELECT version FROM schema_migrations WHERE version='082'`).get()).toBeTruthy();
    d.close();
  });
});

describe("levelRewardDmEnabled gate", () => {
  it("REGRESSION: toggle set to 0 blocks the reward DM", () => {
    expect(levelRewardDmEnabled({ level_reward_dm_enabled: 0 })).toBe(false);
  });

  it("stays enabled for default / missing config", () => {
    expect(levelRewardDmEnabled({ level_reward_dm_enabled: 1 })).toBe(true);
    expect(levelRewardDmEnabled({ level_reward_dm_enabled: null })).toBe(true);
    expect(levelRewardDmEnabled({})).toBe(true);
    expect(levelRewardDmEnabled(undefined)).toBe(true);
  });
});
