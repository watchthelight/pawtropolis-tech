// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech — src/features/levelRewards.ts
 * WHAT: Level rewards handler - grants tokens/tickets when users level up
 * WHY: Automates reward assignment when Amaribot assigns level roles
 * FLOWS:
 *  - guildMemberUpdate detects level role → grant rewards → log to audit trail
 * DOCS:
 *  - Discord.js GuildMember: https://discord.js.org/#/docs/discord.js/main/class/GuildMember
 */

import type { Guild, GuildMember } from "discord.js";
import { logger } from "../lib/logger.js";
import { db } from "../db/db.js";
import {
  assignRole,
  getLevelRewards,
  getRoleTierByRoleId,
  type RoleAssignmentResult,
} from "./roleAutomation.js";
import { isPanicMode } from "./panicStore.js";
import { logActionPretty } from "../logging/pretty.js";

/**
 * Handle when a user receives a level role from Amaribot.
 *
 * This is event-driven: guildMemberUpdate fires when Amaribot assigns a level role,
 * we detect the new role and grant any configured rewards (tickets, tokens, etc).
 *
 * Why separate from Amaribot? We can't modify Amaribot's behavior, but we can react
 * to its role assignments. This decoupling also means our reward logic survives
 * Amaribot outages or config changes.
 *
 * Edge case: If user is assigned multiple level roles simultaneously (rare, but
 * possible if roles are bulk-assigned), each triggers a separate call here.
 */
export async function handleLevelRoleAdded(
  guild: Guild,
  member: GuildMember,
  levelRoleId: string
): Promise<RoleAssignmentResult[]> {
  const results: RoleAssignmentResult[] = [];

  // Panic mode is the emergency brake - if something goes wrong with role
  // automation (wrong roles, infinite loops, etc), admins can /panic to halt
  // all automated role changes immediately.
  if (isPanicMode(guild.id)) {
    logger.warn({
      evt: "level_reward_blocked_panic",
      guildId: guild.id,
      userId: member.id,
      roleId: levelRoleId,
    }, "Level reward blocked - panic mode active");

    // Log to Discord channel
    const botId = guild.client.user?.id ?? "system";
    await logActionPretty(guild, {
      actorId: botId,
      subjectId: member.id,
      action: "role_grant_blocked",
      reason: "Panic mode active",
      meta: { roleId: levelRoleId },
    }).catch((err) => {
      logger.warn({ err, guildId: guild.id, userId: member.id, action: "role_grant_blocked" },
        "[levelRewards] Failed to log action - audit trail incomplete");
    });

    return results;
  }

  try {
    // Look up role in our tier config. Most roles won't be level tiers -
    // we get called for ALL role changes, so null here is the common case.
    const tier = getRoleTierByRoleId(guild.id, levelRoleId);
    if (!tier) {
      logger.debug({
        evt: "level_role_not_configured",
        guildId: guild.id,
        userId: member.id,
        roleId: levelRoleId,
      }, "Role added but not configured as level tier");
      return results;
    }

    // Safety check: tier_type can be 'level', 'boost', 'custom', etc.
    // We only handle level tiers here. Other types have their own handlers.
    if (tier.tier_type !== "level") {
      logger.warn({
        evt: "unexpected_tier_type",
        guildId: guild.id,
        userId: member.id,
        roleId: levelRoleId,
        tierType: tier.tier_type,
      }, "Role tier is not a level tier");
      return results;
    }

    const level = tier.threshold;

    if (typeof level !== 'number' || level < 0 || !Number.isFinite(level)) {
      logger.error({
        evt: "invalid_level_threshold",
        guildId: guild.id,
        userId: member.id,
        roleId: levelRoleId,
        threshold: level,
      }, "Invalid level threshold value");
      return results;
    }

    logger.info({
      evt: "level_up_detected",
      guildId: guild.id,
      userId: member.id,
      username: member.user.username,
      level,
      roleName: tier.tier_name,
    }, `User leveled up to ${level}`);

    // Dedup: check if we have EVER granted rewards for this user+level.
    // Level milestones are permanent one-time achievements — no time window.
    // INC-005: Previous 24h window allowed duplicates when Amaribot re-synced days later.
    const previousGrant = db.prepare(`
      SELECT 1 FROM role_assignments
      WHERE guild_id = ? AND user_id = ? AND reason = ? AND action = 'add'
      LIMIT 1
    `).get(guild.id, member.id, `level_${level}_reward`);

    if (previousGrant) {
      logger.info({
        evt: "level_reward_dedup",
        guildId: guild.id,
        userId: member.id,
        level,
      }, `Skipping duplicate level ${level} reward (already granted previously)`);
      return results;
    }

    // Get rewards for this level
    const rewards = getLevelRewards(guild.id, level);
    if (rewards.length === 0) {
      logger.debug({
        evt: "no_rewards_for_level",
        guildId: guild.id,
        level,
      }, "No rewards configured for this level");
      return results;
    }

    // Write dedup marker BEFORE granting to prevent TOCTOU race condition.
    // INC-005: Concurrent guildMemberUpdate events could all pass the dedup check
    // before any of them wrote role_assignments entries.
    const dedupReason = `level_${level}_reward`;
    const botId = guild.client.user?.id ?? "system";
    db.prepare(`
      INSERT INTO role_assignments (guild_id, user_id, role_id, role_name, action, reason, triggered_by, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(guild.id, member.id, "dedup_marker", `Level ${level} dedup`, "add", dedupReason, botId, null, Math.floor(Date.now() / 1000));

    logger.info({
      evt: "granting_level_rewards",
      guildId: guild.id,
      userId: member.id,
      level,
      rewardCount: rewards.length,
    }, `Granting ${rewards.length} rewards for level ${level}`);

    // Grant rewards sequentially, not in parallel.
    // Why? Discord rate limits role changes per guild. Parallel requests
    // can hit 429s and cause partial failures that are hard to recover from.
    // Rate limit: Discord allows ~5 role changes per 5 seconds per guild.
    // We add 1.1s delay between grants to stay well under the limit.
    const ROLE_GRANT_DELAY_MS = 1100;

    // Collect results by category for consolidated logging
    const grantedRewards: Array<{ name: string; id: string }> = [];
    const skippedRewards: Array<{ name: string; id: string; reason: string }> = [];
    const failedRewards: Array<{ name: string; id: string; error: string }> = [];

    for (let i = 0; i < rewards.length; i++) {
      const reward = rewards[i];
      const result = await assignRole(
        guild,
        member.id,
        reward.role_id,
        `level_${level}_reward`,
        botId
      );
      results.push(result);

      if (result.action === "add") {
        logger.info({
          evt: "reward_granted",
          guildId: guild.id,
          userId: member.id,
          level,
          rewardRole: reward.role_name,
        }, `Granted reward: ${reward.role_name}`);
        grantedRewards.push({ name: reward.role_name, id: reward.role_id });
      } else if (!result.success) {
        // Failed skips: role not found, permission errors, member gone, etc.
        // Must check BEFORE the benign "already has role" skip below.
        logger.error({
          evt: "reward_error",
          guildId: guild.id,
          userId: member.id,
          level,
          rewardRole: reward.role_name,
          error: result.error,
        }, `Failed to grant reward: ${reward.role_name}`);
        failedRewards.push({ name: reward.role_name, id: reward.role_id, error: result.error || "Unknown error" });
      } else if (result.action === "skipped") {
        // Benign skip: user already has the role (success=true, action=skipped).
        // Normal for re-joins or Amaribot re-syncs.
        logger.info({
          evt: "reward_skipped",
          guildId: guild.id,
          userId: member.id,
          level,
          rewardRole: reward.role_name,
          reason: result.reason,
        }, `Skipped reward: ${reward.role_name} (${result.reason})`);
        skippedRewards.push({ name: reward.role_name, id: reward.role_id, reason: result.reason || "Already has role" });
      }

      // Rate limit delay between role grants to avoid hitting Discord's 429s
      // Only delay if there are more rewards to process
      if (i < rewards.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, ROLE_GRANT_DELAY_MS));
      }
    }

    // Log consolidated results to Discord channel (one embed for all rewards)
    // This bunches together multiple rewards at the same level into a single log entry
    if (grantedRewards.length > 0) {
      // DM the user about their rewards first, so we can log the status
      const rewardList = grantedRewards.map(r => `**${r.name}**`).join(", ");
      let dmStatus = "✅ DM Sent";
      await member.send({
        content: `Thanks for being a part of our community! We slid ya ${rewardList} for reaching **Level ${level}**! 🎉`,
      }).catch((err) => {
        dmStatus = "❌ DM Failed (closed)";
        logger.debug({ err, guildId: guild.id, userId: member.id },
          "[levelRewards] Could not DM user about rewards");
      });

      await logActionPretty(guild, {
        actorId: botId,
        subjectId: member.id,
        action: "role_grant",
        reason: `Level ${level} reward`,
        meta: {
          level,
          levelRoleName: tier.tier_name,
          levelRoleId: tier.role_id,
          // Include all granted rewards as arrays
          rewardRoles: grantedRewards.map(r => `${r.name} (<@&${r.id}>)`),
          rewardCount: grantedRewards.length,
          dmStatus,
        },
      }).catch((err) => {
        logger.warn({ err, guildId: guild.id, userId: member.id },
          "[levelRewards] Failed to log action - audit trail incomplete");
      });
    }

    if (skippedRewards.length > 0) {
      // User already has the reward role(s). This is normal for Amaribot re-syncs
      // or re-joins. No DM needed — "already has role" means they got their rewards.
      await logActionPretty(guild, {
        actorId: botId,
        subjectId: member.id,
        action: "role_grant_skipped",
        reason: skippedRewards.map(r => r.reason).join("; "),
        meta: {
          level,
          levelRoleName: tier.tier_name,
          levelRoleId: tier.role_id,
          rewardRoles: skippedRewards.map(r => `${r.name} (<@&${r.id}>)`),
          rewardCount: skippedRewards.length,
        },
      }).catch((err) => {
        logger.warn({ err, guildId: guild.id, userId: member.id },
          "[levelRewards] Failed to log action - audit trail incomplete");
      });
    }

    if (failedRewards.length > 0) {
      await logActionPretty(guild, {
        actorId: botId,
        subjectId: member.id,
        action: "role_grant_blocked",
        reason: failedRewards.map(r => r.error).join("; "),
        meta: {
          level,
          levelRoleName: tier.tier_name,
          levelRoleId: tier.role_id,
          rewardRoles: failedRewards.map(r => `${r.name} (<@&${r.id}>)`),
          rewardCount: failedRewards.length,
        },
      }).catch((err) => {
        logger.warn({ err, guildId: guild.id, userId: member.id },
          "[levelRewards] Failed to log action - audit trail incomplete");
      });
    }

    return results;
  } catch (err) {
    logger.error({
      evt: "level_reward_error",
      guildId: guild.id,
      userId: member.id,
      levelRoleId,
      err,
    }, "Error handling level rewards");
    return results;
  }
}

