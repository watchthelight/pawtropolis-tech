/**
 * Pawtropolis Tech Gatekeeper
 * Copyright (c) 2025 watchthelight (Bash) <admin@watchthelight.org>
 * License: MIT
 * Repo: https://github.com/watchthelight/pawtropolis-tech
 */

import type { ChatInputCommandInteraction, GuildMember } from "discord.js";
import { db } from "../db/connection.js";
import { logger } from "./logger.js";

export function hasManageGuild(member: GuildMember | null): boolean {
  return !!member?.permissions?.has("ManageGuild");
}

export function isReviewer(guildId: string, member: GuildMember | null): boolean {
  if (!member) return false;
  const row = db
    .prepare("SELECT reviewer_role_id FROM guild_config WHERE guild_id = ?")
    .get(guildId) as { reviewer_role_id?: string } | undefined;
  const reviewerRole = row?.reviewer_role_id;
  return !!(reviewerRole && member.roles.cache.has(reviewerRole));
}

export function requireStaff(interaction: ChatInputCommandInteraction): boolean {
  const member = interaction.member as GuildMember | null;
  const ok = hasManageGuild(member) || isReviewer(interaction.guildId!, member);
  if (!ok) {
    interaction
      .reply({
        ephemeral: true,
        content: "You don't have permission to manage gate settings.",
      })
      .catch((err) => logger.warn({ err }, "Failed to send permission denied message"));
  }
  return ok;
}
