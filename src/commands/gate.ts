// SPDX-License-Identifier: LicenseRef-ANW-1.0
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  inlineCode,
  ModalBuilder,
  TextInputBuilder,
  ActionRowBuilder,
  TextInputStyle,
  type ModalSubmitInteraction,
  type GuildMember,
} from "discord.js";
import { requireStaff, hasManageGuild, isReviewer, upsertConfig } from "../lib/config.js";
import { db } from "../db/db.js";
import { ensureGateEntry } from "../features/gate.js";
import { wrapCommand, type CommandContext } from "../lib/cmdWrap.js";

export const data = new SlashCommandBuilder()
  .setName("gate")
  .setDescription("Gatekeeping configuration")
  .addSubcommand((sc) =>
    sc
      .setName("setup")
      .setDescription("Initialize config for this guild")
      .addChannelOption((o) =>
        o.setName("review_channel").setDescription("Staff review channel").setRequired(true)
      )
      .addChannelOption((o) =>
        o.setName("gate_channel").setDescription("Public gate/apply channel").setRequired(true)
      )
      .addChannelOption((o) =>
        o.setName("unverified_channel").setDescription("Unverified chat/ping channel").setRequired(true)
      )
      .addChannelOption((o) =>
        o.setName("general_channel").setDescription("General/welcome channel").setRequired(true)
      )
      .addRoleOption((o) =>
        o.setName("accepted_role").setDescription("Role to grant when accepted").setRequired(true)
      )
      .addRoleOption((o) =>
        o.setName("reviewer_role").setDescription("Role that can review").setRequired(true)
      )
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages);

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;
  if (!interaction.guildId) {
    ctx.step("invalid_scope");
    await interaction.reply({ ephemeral: true, content: "Guild only." });
    return;
  }

  ctx.step("permission_check");
  if (!requireStaff(interaction)) return;

  ctx.step("run_setup");
  const gid = interaction.guildId;

  ctx.step("validate_input");
  const channels = {
    review: interaction.options.getChannel("review_channel", true).id,
    gate: interaction.options.getChannel("gate_channel", true).id,
    unverified: interaction.options.getChannel("unverified_channel", true).id,
    general: interaction.options.getChannel("general_channel", true).id,
    accepted: interaction.options.getRole("accepted_role", true).id,
    reviewer: interaction.options.getRole("reviewer_role", true).id,
  };

  ctx.step("db_write");
  upsertConfig(gid, {
    review_channel_id: channels.review,
    gate_channel_id: channels.gate,
    unverified_channel_id: channels.unverified,
    general_channel_id: channels.general,
    accepted_role_id: channels.accepted,
    reviewer_role_id: channels.reviewer,
  });

  ctx.step("ensure_entry");
  const pinResult = await ensureGateEntry(ctx, gid);

  ctx.step("final_reply");
  await interaction.reply({
    ephemeral: true,
    content:
      "Config saved.\n" +
      `review=${inlineCode(channels.review)}\n` +
      `gate=${inlineCode(channels.gate)}\n` +
      `unverified=${inlineCode(channels.unverified)}\n` +
      `general=${inlineCode(channels.general)}\n` +
      `accepted_role=${inlineCode(channels.accepted)} reviewer_role=${inlineCode(channels.reviewer)}\n` +
      `Pinned ${pinResult.pinned ? "✅" : "⚠️"}${pinResult.reason ? `: ${pinResult.reason}` : ""}`,
  });
}
