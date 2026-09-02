/**
 * Pawtropolis Tech -- src/features/tickets/rendering.ts
 * WHAT: Pure functions that render greeting embeds, action rows, and channel-name
 *       strings. No I/O, no DB. Easy to unit-test and reuse.
 * WHY: Separating rendering from service.ts keeps lifecycle code readable and
 *      lets /assignticket and /closeticket reuse the same Reassigned / Closed
 *      embed shapes without copy-paste.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type GuildMember,
} from "discord.js";
import { PANEL_FOOTER_MARKER } from "./config.js";
import type { TicketTypeConfig } from "./types.js";

/**
 * Lowercase the input, strip non-[a-z0-9-] runs to a single hyphen, drop
 * leading / trailing hyphens, cap at maxLen. Used for the {artist} segment of
 * an art-redeem channel name.
 */
function sanitizeIdentity(raw: string, maxLen = 50): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen);
}

/** Resolve a member's preferred display identity, in order of staff familiarity. */
export function resolveMemberIdentity(member: GuildMember): string {
  const candidate =
    member.nickname ||
    (member.user as { globalName?: string | null }).globalName ||
    member.user.username;
  return sanitizeIdentity(candidate);
}

/**
 * Pad a number with leading zeros per a `0000`-style format spec.
 *
 *   formatNumberToken(7, "0000")  // "0007"
 *   formatNumberToken(123, "0000") // "0123"
 *   formatNumberToken(99999, "0000") // "99999" (does not truncate)
 */
function formatNumberToken(num: number, spec: string): string {
  const width = spec.length;
  return String(num).padStart(width, "0");
}

/**
 * Format a channel name from a template with {num:0000} and optional {artist?}.
 *
 *   formatChannelName("art-{num:0000}-{artist?}", 60, "samepoint")  → "art-0060-samepoint"
 *   formatChannelName("art-{num:0000}-{artist?}", 60, null)         → "art-0060"
 *   formatChannelName("support-{num:0000}", 1099, null)             → "support-1099"
 *
 * Resulting name is truncated to 100 chars (Discord channel-name limit).
 */
export function formatChannelName(
  template: string,
  num: number,
  artistIdentity: string | null
): string {
  // {num:WIDTH}
  let out = template.replace(/\{num:(0+)\}/g, (_, spec) => formatNumberToken(num, spec));

  // {artist?} — empty if null/empty, "-<id>" otherwise
  out = out.replace(/-?\{artist\?\}/g, () => {
    if (!artistIdentity || artistIdentity.length === 0) return "";
    return `-${artistIdentity}`;
  });

  return out.slice(0, 100);
}

/**
 * Build the greeting embed posted as the first message in a new ticket channel.
 * Footer carries the ticket id + opened-at timestamp for quick cross-reference.
 */
export function buildGreetingEmbed(opts: {
  type: TicketTypeConfig;
  ticketId: string;
  ticketNumber: number;
  openedAt: Date;
  claimedByUserId?: string | null;
}): EmbedBuilder {
  const { type, ticketNumber, openedAt, claimedByUserId } = opts;
  const padded = String(ticketNumber).padStart(4, "0");
  const embed = new EmbedBuilder()
    .setColor(type.embedColor)
    .setDescription(type.greetingMd)
    .setFooter({
      text: `${PANEL_FOOTER_MARKER} • Ticket #${type.key}-${padded} • ${openedAt.toISOString().slice(0, 10)}`,
    });

  if (claimedByUserId) {
    embed.addFields({ name: "Claimed by", value: `<@${claimedByUserId}>`, inline: true });
  }

  return embed;
}

/** Build the Claim+Close (or Unclaim+Close) button row under the greeting. */
export function buildGreetingActionRow(
  ticketId: string,
  isClaimed: boolean
): ActionRowBuilder<ButtonBuilder> {
  const claimBtn = new ButtonBuilder()
    .setCustomId(isClaimed ? `tk:unclaim:${ticketId}` : `tk:claim:${ticketId}`)
    .setLabel(isClaimed ? "Unclaim" : "Claim")
    .setStyle(isClaimed ? ButtonStyle.Secondary : ButtonStyle.Primary);

  const closeBtn = new ButtonBuilder()
    .setCustomId(`tk:close:${ticketId}`)
    .setLabel("Close")
    .setEmoji("🔒")
    .setStyle(ButtonStyle.Danger);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(claimBtn, closeBtn);
}
