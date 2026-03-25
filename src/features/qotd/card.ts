/**
 * Pawtropolis Tech — src/features/qotd/card.ts
 * WHAT: Embed builders for QOTD review cards
 * WHY: Visual review flow for staff approval/rejection of member suggestions
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import type { QotdSuggestionRow } from "./types.js";

const COLORS = {
  pending: 0x1e293b,  // slate-800
  approved: 0x10b981, // green-500
  rejected: 0xef4444, // red-500
};

// ── Review Card (staff channel) ───────────────────────────────────────

export interface ReviewEmbedOptions {
  suggestionCount?: number;
  accountCreatedAt?: number | null;
}

export function buildQotdReviewEmbed(
  suggestion: QotdSuggestionRow,
  opts: ReviewEmbedOptions = {}
): EmbedBuilder {
  const embed = new EmbedBuilder().setFooter({
    text: `QOTD #${suggestion.short_code}`,
  });

  const lines: string[] = [
    `> ${suggestion.question}`,
    "",
    `**Suggested by:** <@${suggestion.user_id}>`,
    `**Submitted:** <t:${suggestion.created_at_s}:f> (<t:${suggestion.created_at_s}:R>)`,
  ];

  if (opts.accountCreatedAt) {
    lines.push(`**Account created:** <t:${opts.accountCreatedAt}:R>`);
  }

  if (opts.suggestionCount !== undefined) {
    lines.push(`**Total suggestions:** ${opts.suggestionCount}`);
  }

  if (suggestion.status === "pending") {
    embed.setTitle("QOTD Suggestion").setColor(COLORS.pending);
  } else if (suggestion.status === "approved") {
    embed.setTitle("QOTD Suggestion \u2014 Approved").setColor(COLORS.approved);
    if (suggestion.reviewed_by) {
      lines.push("");
      lines.push(`**Approved by:** <@${suggestion.reviewed_by}>`);
      if (suggestion.reviewed_at_s) {
        lines.push(`**Approved at:** <t:${suggestion.reviewed_at_s}:f>`);
      }
    }
  } else if (suggestion.status === "rejected") {
    embed.setTitle("QOTD Suggestion \u2014 Rejected").setColor(COLORS.rejected);
    if (suggestion.reviewed_by) {
      lines.push("");
      lines.push(`**Rejected by:** <@${suggestion.reviewed_by}>`);
      if (suggestion.reviewed_at_s) {
        lines.push(`**Rejected at:** <t:${suggestion.reviewed_at_s}:f>`);
      }
      if (suggestion.reject_reason) {
        lines.push(`**Reason:** ${suggestion.reject_reason}`);
      }
    }
  } else if (suggestion.status === "used") {
    embed.setTitle("QOTD Suggestion \u2014 Used").setColor(COLORS.approved);
    if (suggestion.used_by) {
      lines.push("");
      lines.push(`**Used by:** <@${suggestion.used_by}>`);
      if (suggestion.used_at_s) {
        lines.push(`**Used at:** <t:${suggestion.used_at_s}:f>`);
      }
    }
  }

  embed.setDescription(lines.join("\n"));
  return embed;
}

export function buildQotdActionRow(
  shortCode: string,
  disabled = false
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`qotd:approve:code${shortCode}`)
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`qotd:reject:code${shortCode}`)
      .setLabel("Reject")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

