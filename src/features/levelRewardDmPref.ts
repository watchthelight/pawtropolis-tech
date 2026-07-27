// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/features/levelRewardDmPref.ts
 * WHAT: Decides whether the level reward DM should be sent for a guild
 * WHY: Extracted from levelRewards.ts so the gate is unit-testable without
 *      pulling in discord.js and the live db (precedent: buttonCooldown.ts)
 */

import type { GuildConfig } from "../lib/config.js";

export function levelRewardDmEnabled(
  cfg: Pick<GuildConfig, "level_reward_dm_enabled"> | undefined
): boolean {
  return cfg?.level_reward_dm_enabled !== 0;
}
