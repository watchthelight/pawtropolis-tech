/**
 * Pawtropolis Tech — src/features/qotd/handlers.ts
 * WHAT: Button + modal interaction handlers for QOTD suggestion system
 * WHY: Approve/reject buttons on review cards, suggest modal submission
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ButtonInteraction,
  ModalSubmitInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  GuildMember,
  MessageFlags,
  EmbedBuilder,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import { shouldBypass, hasRoleOrAbove, ROLE_IDS, getConfig } from "../../lib/config.js";
import { shortCode } from "../../lib/ids.js";
import { BTN_QOTD_RE } from "../../lib/modalPatterns.js";
import {
  getSuggestionByCode,
  approveSuggestion,
  rejectSuggestion,
  insertSuggestion,
  setReviewMessageId,
  countPendingByUser,
  getLastSuggestionTime,
  getSuggestionById,
} from "./db.js";
import { buildQotdReviewEmbed, buildQotdActionRow } from "./card.js";
import type { QotdSuggestionRow } from "./types.js";

// ── Staff check ───────────────────────────────────────────────────────

function isStaff(member: GuildMember | null, userId: string): boolean {
  if (shouldBypass(userId, member)) return true;
  return hasRoleOrAbove(member, ROLE_IDS.GATEKEEPER);
}

function requireStaff(interaction: ButtonInteraction | ModalSubmitInteraction): boolean {
  if (!interaction.inGuild() || !interaction.guildId) {
    interaction
      .reply({ flags: MessageFlags.Ephemeral, content: "Guild only." })
      .catch((err) => { logger.warn({ err }, "[qotd] guild-only reply failed"); });
    return false;
  }
  const member = interaction.member as GuildMember | null;
  if (!isStaff(member, interaction.user.id)) {
    interaction
      .reply({
        flags: MessageFlags.Ephemeral,
        content: "You do not have the Gatekeeper role required for this action.",
      })
      .catch((err) => { logger.warn({ err }, "[qotd] permission denied reply failed"); });
    return false;
  }
  return true;
}

// ── DM helpers (fail-soft) ────────────────────────────────────────────

async function dmSuggester(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  suggestion: QotdSuggestionRow,
  embed: EmbedBuilder
): Promise<void> {
  try {
    const guild = interaction.client.guilds.cache.get(suggestion.guild_id);
    if (!guild) return;
    const user = await interaction.client.users.fetch(suggestion.user_id);
    await user.send({ embeds: [embed] });
  } catch {
    // DMs disabled or user not found — non-fatal
    logger.debug({ userId: suggestion.user_id }, "[qotd] failed to DM suggester");
  }
}

// ── Button Handlers ───────────────────────────────────────────────────

export async function handleQotdButton(interaction: ButtonInteraction): Promise<void> {
  const match = BTN_QOTD_RE.exec(interaction.customId);
  if (!match) return;

  const [, action, code] = match;

  if (action === "reject") {
    // Reject opens a modal for reason — no defer before showModal
    if (!requireStaff(interaction)) return;

    const suggestion = getSuggestionByCode(interaction.guildId!, code);
    if (!suggestion || suggestion.status !== "pending") {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: suggestion ? "This suggestion has already been resolved." : "Suggestion not found.",
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`v1:modal:qotd:reject:${code}`)
      .setTitle("Reject QOTD Suggestion")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("reason")
            .setLabel("Rejection reason")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(500)
            .setPlaceholder("Why is this suggestion being rejected?")
        )
      );

    await interaction.showModal(modal);
    return;
  }

  // Approve — defer and process
  if (!requireStaff(interaction)) return;

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate().catch((err) => { logger.warn({ err }, "[qotd] approve deferUpdate failed"); });
  }

  const suggestion = getSuggestionByCode(interaction.guildId!, code);
  if (!suggestion) {
    await interaction.followUp({
      flags: MessageFlags.Ephemeral,
      content: "Suggestion not found.",
    });
    return;
  }

  if (suggestion.status !== "pending") {
    await interaction.followUp({
      flags: MessageFlags.Ephemeral,
      content: "This suggestion has already been resolved.",
    });
    return;
  }

  const updated = approveSuggestion(suggestion.id, interaction.user.id);
  if (!updated) {
    await interaction.followUp({
      flags: MessageFlags.Ephemeral,
      content: "Failed to approve — suggestion may have been resolved by someone else.",
    });
    return;
  }

  // Refresh the review card
  const fresh = getSuggestionById(suggestion.id);
  if (fresh && interaction.message) {
    const embed = buildQotdReviewEmbed(fresh);
    const row = buildQotdActionRow(fresh.short_code, true);
    await interaction.message.edit({ embeds: [embed], components: [row] }).catch((err) => {
      logger.warn({ err, suggestionId: suggestion.id }, "[qotd] failed to update review card");
    });
  }

  // DM the suggester
  if (fresh) {
    const dmEmbed = new EmbedBuilder()
      .setTitle("QOTD Suggestion Approved!")
      .setDescription(
        `Your question has been approved and added to the QOTD queue:\n\n> ${fresh.question}\n\nIt will be posted automatically when it's next in line.`
      )
      .setColor(0x10b981)
      .setTimestamp();
    await dmSuggester(interaction, fresh, dmEmbed);
  }

  logger.info(
    { guildId: interaction.guildId, suggestionId: suggestion.id, reviewerId: interaction.user.id },
    "[qotd] suggestion approved"
  );
}

// ── Modal Handlers ────────────────────────────────────────────────────

/**
 * Handles the /qotd suggest modal submission.
 * Inserts the suggestion, posts a review card to the review channel.
 */
export async function handleQotdSuggestModal(
  interaction: ModalSubmitInteraction
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: "Guild only." });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const question = interaction.fields.getTextInputValue("question").trim();
  if (!question || question.length > 500) {
    await interaction.editReply({ content: "Question must be 1-500 characters." });
    return;
  }

  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  // Rate limit recheck (race condition guard)
  const pendingCount = countPendingByUser(guildId, userId);
  if (pendingCount >= 5) {
    await interaction.editReply({
      content: "You already have 5 pending suggestions. Wait for some to be reviewed first.",
    });
    return;
  }

  const lastTime = getLastSuggestionTime(guildId, userId);
  const nowS = Math.floor(Date.now() / 1000);
  if (lastTime && nowS - lastTime < 3600) {
    const nextAllowed = lastTime + 3600;
    await interaction.editReply({
      content: `You can submit another suggestion <t:${nextAllowed}:R>.`,
    });
    return;
  }

  // Generate short code and insert
  const code = shortCode(`${userId}-${Date.now()}`);
  const id = insertSuggestion(guildId, userId, question, code);

  // Post review card to staff channel
  const config = getConfig(guildId);
  const reviewChannelId = config?.qotd_review_channel_id;

  if (reviewChannelId) {
    try {
      const guild = interaction.client.guilds.cache.get(guildId);
      const channel = guild ? await guild.channels.fetch(reviewChannelId) : null;

      if (channel && channel.isTextBased()) {
        const suggestion = getSuggestionById(id);
        if (suggestion) {
          // Get account creation time from Discord snowflake
          const accountCreatedAt = Math.floor(
            Number(BigInt(userId) >> 22n) / 1000 + 1420070400
          );

          const embed = buildQotdReviewEmbed(suggestion, {
            accountCreatedAt,
          });
          const actionRow = buildQotdActionRow(code);

          const qotdRoleId = config?.qotd_role_id;
          const msg = await channel.send({
            content: qotdRoleId ? `<@&${qotdRoleId}> New QOTD suggestion` : undefined,
            embeds: [embed],
            components: [actionRow],
            allowedMentions: { roles: qotdRoleId ? [qotdRoleId] : [] },
          });

          setReviewMessageId(id, msg.id);
        }
      }
    } catch (err) {
      logger.warn({ err, guildId, reviewChannelId }, "[qotd] failed to post review card");
    }
  }

  await interaction.editReply({
    content: "Your QOTD suggestion has been submitted for review! You'll be notified when it's approved or rejected.",
  });

  logger.info(
    { guildId, userId, suggestionId: id, shortCode: code },
    "[qotd] new suggestion submitted"
  );
}

/**
 * Handles the QOTD rejection modal (staff enters reason).
 */
export async function handleQotdRejectModal(
  interaction: ModalSubmitInteraction,
  code: string
): Promise<void> {
  if (!requireStaff(interaction)) return;

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate().catch((err) => { logger.warn({ err }, "[qotd] reject deferUpdate failed"); });
  }

  const reason = interaction.fields.getTextInputValue("reason").trim();
  if (!reason) return;

  const suggestion = getSuggestionByCode(interaction.guildId!, code);
  if (!suggestion) {
    await interaction.followUp({
      flags: MessageFlags.Ephemeral,
      content: "Suggestion not found.",
    }).catch((err) => { logger.warn({ err }, "[qotd] suggestion-not-found followUp failed"); });
    return;
  }

  if (suggestion.status !== "pending") {
    await interaction.followUp({
      flags: MessageFlags.Ephemeral,
      content: "This suggestion has already been resolved.",
    }).catch((err) => { logger.warn({ err }, "[qotd] already-resolved followUp failed"); });
    return;
  }

  const updated = rejectSuggestion(suggestion.id, interaction.user.id, reason);
  if (!updated) {
    await interaction.followUp({
      flags: MessageFlags.Ephemeral,
      content: "Failed to reject — suggestion may have been resolved by someone else.",
    }).catch((err) => { logger.warn({ err }, "[qotd] reject-failed followUp failed"); });
    return;
  }

  // Refresh the review card
  const fresh = getSuggestionById(suggestion.id);
  if (fresh && interaction.message) {
    const embed = buildQotdReviewEmbed(fresh);
    const row = buildQotdActionRow(fresh.short_code, true);
    await interaction.message.edit({ embeds: [embed], components: [row] }).catch((err) => {
      logger.warn({ err, suggestionId: suggestion.id }, "[qotd] failed to update review card");
    });
  }

  // DM the suggester with rejection reason
  if (fresh) {
    const dmEmbed = new EmbedBuilder()
      .setTitle("QOTD Suggestion Not Approved")
      .setDescription(
        `Your QOTD suggestion was not approved:\n\n> ${fresh.question}\n\n**Reason:** ${reason}\n\nFeel free to submit a new suggestion!`
      )
      .setColor(0xef4444)
      .setTimestamp();
    await dmSuggester(interaction, fresh, dmEmbed);
  }

  logger.info(
    {
      guildId: interaction.guildId,
      suggestionId: suggestion.id,
      reviewerId: interaction.user.id,
      reason,
    },
    "[qotd] suggestion rejected"
  );
}
