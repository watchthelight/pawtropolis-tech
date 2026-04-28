/**
 * Pawtropolis Tech -- src/features/tickets/permissions.ts
 * WHAT: Builds Discord permission overwrites from a TicketTypeConfig.permTemplate.
 * WHY: Each ticket type has a specific privacy posture (reports = Mod Team only;
 *      art / verification = Community Ambassador; support = both). Centralizing
 *      the translation keeps service.ts focused on lifecycle, not bit-twiddling.
 *
 * GOTCHA: For the bot's own overwrite we pass the GuildMember object, not the
 * raw bot ID. discord.js otherwise tries to resolve the ID via the role cache
 * and silently does the wrong thing if the bot's roles aren't fully cached at
 * channel-create time. modmail/threadPerms.ts learned this the hard way.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  PermissionFlagsBits,
  type Guild,
  type OverwriteResolvable,
  type PermissionResolvable,
} from "discord.js";
import { logger } from "../../lib/logger.js";
import type { PermTemplate } from "./types.js";

/**
 * Map a string permission name (e.g. "ViewChannel") to the discord.js bitfield.
 * Unknown names log a warning and are skipped — better to ship a partially-
 * working overwrite than to crash on a future schema entry we don't recognize.
 */
function nameToFlag(name: string): bigint | null {
  if (name in PermissionFlagsBits) {
    return PermissionFlagsBits[name as keyof typeof PermissionFlagsBits] as bigint;
  }
  logger.warn({ name }, "[tickets/permissions] unknown permission name in template");
  return null;
}

function namesToBitfield(names: string[]): PermissionResolvable[] {
  const out: PermissionResolvable[] = [];
  for (const n of names) {
    const flag = nameToFlag(n);
    if (flag !== null) out.push(flag);
  }
  return out;
}

/**
 * Build the full overwrites array for a new ticket channel.
 *
 * Includes:
 *   - @everyone deny block
 *   - per-role allow blocks from the type's permTemplate
 *   - opener allow / deny block
 *   - bot allow block (always: ManageChannels + Send + ManageMessages + Embed
 *     + Attach + ReadHistory + MentionEveryone), via GuildMember to avoid
 *     the role-cache resolution gotcha.
 */
export function buildTicketOverwrites(
  guild: Guild,
  template: PermTemplate,
  openerUserId: string
): OverwriteResolvable[] {
  const overwrites: OverwriteResolvable[] = [];

  // 1. @everyone — deny ViewChannel etc per template
  if (template.everyone_deny.length > 0) {
    overwrites.push({
      id: guild.roles.everyone.id,
      deny: namesToBitfield(template.everyone_deny),
    });
  }

  // 2. Per-role allow blocks
  for (const role of template.roles) {
    overwrites.push({
      id: role.id,
      allow: namesToBitfield(role.allow),
    });
  }

  // 3. Opener allow + deny
  overwrites.push({
    id: openerUserId,
    allow: namesToBitfield(template.opener_allow),
    deny: namesToBitfield(template.opener_deny),
  });

  // 4. Bot — pass the GuildMember to dodge the role-cache resolution bug
  const me = guild.members.me;
  if (me) {
    overwrites.push({
      id: me.id,
      allow: [
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.MentionEveryone,
        PermissionFlagsBits.ManageThreads,
        PermissionFlagsBits.CreatePrivateThreads,
      ],
    });
  } else {
    logger.warn(
      { guildId: guild.id },
      "[tickets/permissions] guild.members.me is null — bot overwrite skipped, channel may be unmanageable"
    );
  }

  return overwrites;
}
