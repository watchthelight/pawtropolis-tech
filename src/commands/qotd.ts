/**
 * Pawtropolis Tech — src/commands/qotd.ts
 * WHAT: /qotd command — suggest, queue, pull subcommands
 * WHY: Community-driven QOTD suggestions — members suggest, staff approve,
 *      staff pull random approved questions to use for their QOTD posts
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  GuildMember,
} from "discord.js";
import type { CommandContext } from "../lib/cmdWrap.js";
import { withStep, replyOrEdit } from "../lib/cmdWrap.js";
import { hasRoleOrAbove, ROLE_IDS, shouldBypass } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import {
  countPendingByUser,
  getLastSuggestionTime,
  getApprovedQueueSize,
  getPendingQueueSize,
  getRandomApproved,
  markSuggestionUsed,
} from "../features/qotd/db.js";

export const data = new SlashCommandBuilder()
  .setName("qotd")
  .setDescription("Question of the Day suggestion system")
  .addSubcommand((sub) =>
    sub
      .setName("suggest")
      .setDescription("Suggest a Question of the Day")
  )
  .addSubcommand((sub) =>
    sub
      .setName("queue")
      .setDescription("View QOTD queue status (staff)")
  )
  .addSubcommand((sub) =>
    sub
      .setName("pull")
      .setDescription("Pull a random approved QOTD suggestion (staff)")
  );

function isStaff(member: GuildMember | null, userId: string): boolean {
  if (shouldBypass(userId, member)) return true;
  return hasRoleOrAbove(member, ROLE_IDS.GATEKEEPER);
}

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const subcommand = interaction.options.getSubcommand();

  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({ content: "Guild only.", flags: MessageFlags.Ephemeral });
    return;
  }

  switch (subcommand) {
    case "suggest":
      await handleSuggest(ctx);
      break;
    case "queue":
      await handleQueue(ctx);
      break;
    case "pull":
      await handlePull(ctx);
      break;
  }
}

// ── /qotd suggest ─────────────────────────────────────────────────────

async function handleSuggest(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;

  // Rate limit checks before showing modal
  await withStep(ctx, "rate_limit", async () => {
    const pendingCount = countPendingByUser(guildId, userId);
    if (pendingCount >= 5) {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: "You already have 5 pending suggestions. Wait for some to be reviewed first.",
      });
      return;
    }

    const lastTime = getLastSuggestionTime(guildId, userId);
    const nowS = Math.floor(Date.now() / 1000);
    if (lastTime && nowS - lastTime < 3600) {
      const nextAllowed = lastTime + 3600;
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `You can submit another suggestion <t:${nextAllowed}:R>.`,
      });
      return;
    }

    // Show the suggest modal — must NOT defer before showModal
    const modal = new ModalBuilder()
      .setCustomId("v1:modal:qotd:suggest")
      .setTitle("Suggest a Question of the Day")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("question")
            .setLabel("Your Question (4-5 sentences max)")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMinLength(10)
            .setMaxLength(500)
            .setPlaceholder("Keep it short, creative, and thought-provoking! No NSFW/gore/substances.")
        )
      );

    await interaction.showModal(modal);
  });
}

// ── /qotd queue (staff) ──────────────────────────────────────────────

async function handleQueue(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const member = interaction.member as GuildMember | null;

  if (!isStaff(member, interaction.user.id)) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "Gatekeeper role required.",
    });
    return;
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  const guildId = interaction.guildId!;
  const approved = getApprovedQueueSize(guildId);
  const pending = getPendingQueueSize(guildId);

  const lines = [
    `**Approved (ready to pull):** ${approved}`,
    `**Pending review:** ${pending}`,
  ];

  if (approved === 0) {
    lines.push("\n*Queue is empty. Approve some suggestions!*");
  }

  await replyOrEdit(interaction, { content: lines.join("\n") });
}

// ── /qotd pull (staff) ──────────────────────────────────────────────

async function handlePull(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  const member = interaction.member as GuildMember | null;

  if (!isStaff(member, interaction.user.id)) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "Gatekeeper role required.",
    });
    return;
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  const guildId = interaction.guildId!;
  const suggestion = getRandomApproved(guildId);

  if (!suggestion) {
    await replyOrEdit(interaction, {
      content: "No approved suggestions available. Approve some first!",
    });
    return;
  }

  // Mark as used so it won't be pulled again
  markSuggestionUsed(suggestion.id, interaction.user.id);

  const remaining = getApprovedQueueSize(guildId);

  await replyOrEdit(interaction, {
    content: [
      `**QOTD Suggestion** (from <@${suggestion.user_id}>):`,
      "",
      `> ${suggestion.question}`,
      "",
      `*${remaining} suggestion${remaining === 1 ? "" : "s"} remaining in queue.*`,
    ].join("\n"),
  });

  logger.info(
    { guildId, userId: interaction.user.id, suggestionId: suggestion.id },
    "[qotd] suggestion pulled by staff"
  );
}
