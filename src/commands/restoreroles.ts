// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech — src/commands/restoreroles.ts
 * WHAT: /restoreroles user:@x [dry_run] — re-grant roles a user had before leaving/kick/ban
 * WHY: Returning members come back with no roles; mods otherwise re-grant manually
 * FLOWS:
 *  - Look up most recent member_role_snapshots row for (guild, user)
 *  - Filter (deleted, managed, hierarchy, already-has) and apply remaining in one batch
 *  - Reply with restored + skipped lists
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { type CommandContext } from "../lib/cmdWrap.js";
import { logger } from "../lib/logger.js";
import { logActionPretty } from "../logging/pretty.js";
import { requireMinRole, ROLE_IDS } from "../lib/config.js";
import { restoreRoles, getLatestSnapshot } from "../features/roleSnapshot.js";

export const data = new SlashCommandBuilder()
  .setName("restoreroles")
  .setDescription("Restore roles a user had before they left, were kicked, or banned.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .setDMPermission(false)
  .addUserOption((opt) =>
    opt.setName("user").setDescription("User to restore roles for.").setRequired(true)
  )
  .addBooleanOption((opt) =>
    opt
      .setName("dry_run")
      .setDescription("Preview what would be restored without applying.")
      .setRequired(false)
  );

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const interaction = ctx.interaction;

  if (!interaction.guild) {
    await interaction.reply({ content: "Guild only.", flags: MessageFlags.Ephemeral });
    return;
  }

  // Admin-only: granting roles in bulk is sensitive.
  if (
    !requireMinRole(interaction, ROLE_IDS.ADMINISTRATOR, {
      command: "restoreroles",
      description: "Restore previously-held roles for a returning member.",
      requirements: [{ type: "hierarchy", minRoleId: ROLE_IDS.ADMINISTRATOR }],
    })
  ) {
    return;
  }

  const targetUser = interaction.options.getUser("user", true);
  const dryRun = interaction.options.getBoolean("dry_run") ?? false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Member must be in the guild for us to grant roles. Banned users won't fetch
  // until unbanned. Surface that distinction clearly.
  const member = await interaction.guild.members
    .fetch({ user: targetUser.id, force: true })
    .catch(() => null);

  if (!member) {
    const snap = getLatestSnapshot(interaction.guild.id, targetUser.id);
    const note = snap
      ? `A snapshot exists from <t:${snap.removed_at}:R> (${snap.removal_type}). Unban or wait for them to rejoin first.`
      : "No snapshot exists for this user either.";
    await interaction.editReply({
      content: `<@${targetUser.id}> is not in the server. ${note}`,
    });
    return;
  }

  let report;
  try {
    report = await restoreRoles(member, interaction.user.id, { dryRun });
  } catch (err) {
    logger.error(
      { err, guildId: interaction.guild.id, userId: targetUser.id },
      "[restoreroles] failed"
    );
    await interaction.editReply({
      content: `Failed to restore roles: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  if (report.notFound) {
    await interaction.editReply({
      content: `No role snapshot found for <@${targetUser.id}>. They were never captured leaving, or the snapshot table predates their removal.`,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(dryRun ? "Restore Roles — Preview" : "Roles Restored")
    .setColor(dryRun ? 0xf59e0b : 0x10b981)
    .setDescription(
      [
        `**User:** <@${targetUser.id}>`,
        `**Snapshot:** #${report.snapshotId} — ${report.removalType ?? "unknown"} <t:${report.removedAt}:R>`,
      ].join("\n")
    );

  if (report.restored.length > 0) {
    embed.addFields({
      name: dryRun
        ? `Would restore (${report.restored.length})`
        : `Restored (${report.restored.length})`,
      value: report.restored.map((id) => `<@&${id}>`).join(" ") || "—",
    });
  } else {
    embed.addFields({ name: "Restored", value: "_None applicable._" });
  }

  if (report.skipped.length > 0) {
    // Discord embed field cap is 1024 chars. Truncate gracefully.
    const lines = report.skipped.map((s) => `<@&${s.roleId}> — ${s.reason}`);
    let value = lines.join("\n");
    if (value.length > 1000) {
      value = value.slice(0, 1000) + `\n…and ${lines.length} total`;
    }
    embed.addFields({ name: `Skipped (${report.skipped.length})`, value });
  }

  await interaction.editReply({ embeds: [embed] });

  if (!dryRun && report.restored.length > 0) {
    await logActionPretty(interaction.guild, {
      actorId: interaction.user.id,
      subjectId: targetUser.id,
      action: "role_grant",
      reason: `Restored ${report.restored.length} role(s) from snapshot #${report.snapshotId}`,
      meta: {
        snapshotId: report.snapshotId,
        removalType: report.removalType,
        restored: report.restored,
        skipped: report.skipped,
      },
    });
  }
}
