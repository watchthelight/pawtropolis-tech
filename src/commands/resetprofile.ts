/**
 * Pawtropolis Tech -- src/commands/resetprofile.ts
 * WHAT: Clears one member's reward bookkeeping so the reward paths can be tested again.
 * WHY: Level and inventory dedup markers are permanent, so an account that has already
 *      earned a reward can never earn it twice. Testing needs a way back to zero.
 * FLOWS:
 *  - password + permission check -> resetMemberRewardState -> audit log -> counts embed
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  type GuildMember,
} from "discord.js";
import { withStep, type CommandContext } from "../lib/cmdWrap.js";
import { logger } from "../lib/logger.js";
import { logActionPretty } from "../logging/pretty.js";
import { secureCompare } from "../lib/secureCompare.js";
import { checkCooldown, formatCooldown, COOLDOWNS } from "../lib/rateLimiter.js";
import { resetMemberRewardState, totalRowsCleared } from "../features/rewardReset.js";

export const data = new SlashCommandBuilder()
  .setName("resetprofile")
  .setDescription("Clear a member's reward history so they can earn it again (requires password)")
  .setDMPermission(false)
  .addUserOption((option) =>
    option.setName("user").setDescription("Member to reset").setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("password")
      .setDescription("Reset password (same as gate reset)")
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

/**
 * execute
 * WHAT: Wipes one member's level reward markers and inventory rows.
 * SECURITY:
 *  - Requires ManageGuild permission OR ADMIN_ROLE_ID
 *  - Validates password with constant-time comparison
 *  - Logs action to audit trail
 */
export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  });

  const password = interaction.options.getString("password", true).trim();
  const target = interaction.options.getUser("user", true);
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.editReply({
      content: "❌ This command can only be used in a guild.",
    });
    return;
  }

  const passwordCooldownKey = `resetprofile:${guildId}:${interaction.user.id}`;
  const cooldownResult = checkCooldown("password_fail", passwordCooldownKey, COOLDOWNS.PASSWORD_FAIL_MS);
  if (!cooldownResult.allowed) {
    await interaction.editReply({
      content: `❌ Too many failed attempts. Try again in ${formatCooldown(cooldownResult.remainingMs!)}.`,
    });
    return;
  }

  const correctPassword = process.env.RESET_PASSWORD;

  if (!correctPassword) {
    logger.error("[resetprofile] RESET_PASSWORD not configured in environment");
    await interaction.editReply({
      content: "❌ Reset password not configured. Contact bot administrator.",
    });
    return;
  }

  if (!secureCompare(password, correctPassword)) {
    logger.warn({ userId: interaction.user.id, guildId }, "[resetprofile] incorrect password attempt");
    await interaction.editReply({
      content: "❌ Incorrect password. Reset denied.",
    });
    return;
  }

  // Two-layer auth: setDefaultMemberPermissions controls visibility, but permissions
  // can change between registration and execution, so check again here.
  const member = interaction.member as GuildMember | null;
  const adminRoleIds = (process.env.ADMIN_ROLE_ID || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const hasManageGuild =
    member && typeof member.permissions !== "string" && member.permissions.has(PermissionFlagsBits.ManageGuild);
  const hasAdminRole =
    member &&
    "cache" in member.roles &&
    adminRoleIds.length > 0 &&
    adminRoleIds.some((roleId) => member.roles.cache.has(roleId));

  if (!hasManageGuild && !hasAdminRole) {
    logger.warn(
      { userId: interaction.user.id, guildId },
      "[resetprofile] unauthorized attempt (no permissions)"
    );
    await interaction.editReply({
      content: "❌ You don't have permission to reset a member's rewards.",
    });
    return;
  }

  const counts = await withStep(ctx, "reset_reward_state", async () =>
    resetMemberRewardState(guildId, target.id)
  );

  await withStep(ctx, "log_action", async () => {
    if (!interaction.guild) return;
    await logActionPretty(interaction.guild, {
      actorId: interaction.user.id,
      subjectId: target.id,
      action: "profile_reset",
      reason: "Reward history cleared for re-testing",
      meta: { ...counts, total: totalRowsCleared(counts) },
    });
  });

  logger.info(
    { evt: "reward_state_reset", userId: interaction.user.id, guildId, targetId: target.id, ...counts },
    `[resetprofile] cleared ${totalRowsCleared(counts)} rows for ${target.id}`
  );

  const embed = new EmbedBuilder()
    .setTitle("✅ Reward History Cleared")
    .setDescription(
      `<@${target.id}> can earn every level reward and inventory item again. Roles they currently hold were not touched.`
    )
    .addFields(
      { name: "Level rewards", value: String(counts.levelRewards), inline: true },
      { name: "Item stacks", value: String(counts.items), inline: true },
      { name: "Ledger rows", value: String(counts.log), inline: true },
      { name: "Grant keys", value: String(counts.grantKeys), inline: true },
      { name: "Queued captures", value: String(counts.pendingCaptures), inline: true }
    )
    .setColor(0x57f287)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
