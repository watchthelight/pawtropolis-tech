// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/features/rewardReset.ts
 * WHAT: Clears one member's reward bookkeeping so they can earn the same rewards again.
 * WHY: Level rewards and inventory dedup markers are permanent by design, which is
 *      correct in production and makes the reward path untestable. Staff need a way to
 *      put a test account back to zero without touching anyone else.
 *
 * Roles are deliberately left alone: this only forgets what the bot recorded.
 * No discord.js import, so it runs directly against an in-memory database in tests.
 */

import { db } from "../db/db.js";

export interface ResetCounts {
  levelRewards: number;
  items: number;
  log: number;
  grantKeys: number;
  pendingCaptures: number;
}

export function totalRowsCleared(counts: ResetCounts): number {
  return (
    counts.levelRewards + counts.items + counts.log + counts.grantKeys + counts.pendingCaptures
  );
}

/** Delete every reward record this guild holds for one member. */
export function resetMemberRewardState(guildId: string, userId: string): ResetCounts {
  const clear = (table: string): number =>
    db.prepare(`DELETE FROM ${table} WHERE guild_id = ? AND user_id = ?`).run(guildId, userId)
      .changes;

  const run = db.transaction((): ResetCounts => ({
    levelRewards: clear("level_reward_granted"),
    items: clear("inventory_items"),
    log: clear("inventory_log"),
    grantKeys: clear("inventory_grant_keys"),
    pendingCaptures: clear("pending_item_capture"),
  }));

  return run();
}
