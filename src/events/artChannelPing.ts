// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech — src/events/artChannelPing.ts
 * WHAT: Auto-pings art roles when someone posts in their dedicated channels
 * WHY: Artists forget or are afraid to ping; this boosts engagement automatically
 * DESIGN: 10-minute per-channel cooldown prevents spam
 */

import type { Message } from "discord.js";
import { logger } from "../lib/logger.js";

// Channel ID → Role ID mapping
const ART_CHANNEL_ROLES: ReadonlyMap<string, string> = new Map([
  ["1400346864947302461", "1128920851601969242"], // art-commissions → Art Comms
  ["1400348382798807060", "1128920968581091428"], // adopts → Art Adopts
  ["1400348338972528763", "1128921121593507860"], // verified-artwork → Verified Art
]);

// Per-channel cooldown tracking (channel ID → last ping timestamp)
const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

export async function artChannelPing(message: Message): Promise<void> {
  if (!message.guild) return;
  if (message.author.bot) return;

  const roleId = ART_CHANNEL_ROLES.get(message.channelId);
  if (!roleId) return;

  // Only ping for art posts (must contain media — images, embeds, or attachments)
  const hasMedia = message.attachments.size > 0 || message.embeds.some((e) => e.image || e.thumbnail || e.video);
  if (!hasMedia) return;

  // Per-channel cooldown
  const lastPing = cooldowns.get(message.channelId) ?? 0;
  const now = Date.now();
  if (now - lastPing < COOLDOWN_MS) return;

  cooldowns.set(message.channelId, now);

  try {
    await message.channel.send({
      content: `<@&${roleId}>`,
      allowedMentions: { roles: [roleId], users: [], repliedUser: false },
    });
  } catch (err) {
    logger.warn({ err, channelId: message.channelId, roleId }, "[artChannelPing] Failed to send ping");
  }
}
