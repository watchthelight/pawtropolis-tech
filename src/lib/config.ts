// SPDX-License-Identifier: LicenseRef-ANW-1.0
import type { ChatInputCommandInteraction, GuildMember } from "discord.js";
import { db } from "../db/db.js";
import { logger } from "./logger.js";

export type GuildConfig = {
  guild_id: string;
  review_channel_id?: string | null;
  gate_channel_id?: string | null;
  unverified_channel_id?: string | null;
  general_channel_id?: string | null;
  accepted_role_id?: string | null;
  reviewer_role_id?: string | null;
  image_search_url_template: string;
  reapply_cooldown_hours: number;
  min_account_age_hours: number;
  min_join_age_hours: number;
  avatar_scan_enabled: number;
  avatar_scan_nsfw_threshold: number;
  avatar_scan_skin_edge_threshold: number;
};

const configCache = new Map<string, { config: GuildConfig; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function invalidateCache(guildId: string) {
  configCache.delete(guildId);
}

export function upsertConfig(guildId: string, partial: Partial<Omit<GuildConfig, "guild_id">>) {
  const existing = db.prepare("SELECT * FROM guild_config WHERE guild_id = ?").get(guildId);
  if (!existing) {
    db.prepare(
      `
      INSERT INTO guild_config (
        guild_id, review_channel_id, gate_channel_id, unverified_channel_id, general_channel_id,
        accepted_role_id, reviewer_role_id, image_search_url_template,
        reapply_cooldown_hours, min_account_age_hours, min_join_age_hours,
        avatar_scan_enabled, avatar_scan_nsfw_threshold, avatar_scan_skin_edge_threshold
      ) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'https://lens.google.com/uploadbyurl?url={avatarUrl}'), COALESCE(?,24), COALESCE(?,0), COALESCE(?,0), COALESCE(?,0), COALESCE(?,0.60), COALESCE(?,0.18))
    `
    ).run(
      guildId,
      partial.review_channel_id ?? null,
      partial.gate_channel_id ?? null,
      partial.unverified_channel_id ?? null,
      partial.general_channel_id ?? null,
      partial.accepted_role_id ?? null,
      partial.reviewer_role_id ?? null,
      partial.image_search_url_template,
      partial.reapply_cooldown_hours,
      partial.min_account_age_hours,
      partial.min_join_age_hours,
      partial.avatar_scan_enabled ?? 0,
      partial.avatar_scan_nsfw_threshold ?? 0.6,
      partial.avatar_scan_skin_edge_threshold ?? 0.18
    );
  } else {
    const keys = Object.keys(partial) as Array<keyof typeof partial>;
    if (keys.length === 0) return;
    const sets = keys.map((k) => `${k} = ?`).join(", ") + ", updated_at = datetime('now')";
    const vals = keys.map((k) => partial[k]);
    db.prepare(`UPDATE guild_config SET ${sets} WHERE guild_id = ?`).run(...vals, guildId);
  }
  invalidateCache(guildId);
}

export function getConfig(guildId: string): GuildConfig | undefined {
  const cached = configCache.get(guildId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.config;
  }
  const config = db.prepare("SELECT * FROM guild_config WHERE guild_id = ?").get(guildId) as
    | GuildConfig
    | undefined;

  if (config) {
    configCache.set(guildId, { config, timestamp: Date.now() });
  }
  return config;
}

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
