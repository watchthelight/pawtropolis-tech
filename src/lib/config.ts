// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech Gatekeeper
 * Copyright (c) 2025 watchthelight (Bash) <admin@watchthelight.org>
 * License: LicenseRef-ANW-1.0
 * Repo: https://github.com/watchthelight/pawtropolis-tech
 */

import { db } from "../db/connection.js";

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
};

// guild configs in-memory cache
const configCache = new Map<string, { config: GuildConfig; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5mins

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
        reapply_cooldown_hours, min_account_age_hours, min_join_age_hours
      ) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'https://lens.google.com/uploadbyurl?url={avatarUrl}'), COALESCE(?,24), COALESCE(?,0), COALESCE(?,0))
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
      partial.min_join_age_hours
    );
  } else {
    const keys = Object.keys(partial) as Array<keyof typeof partial>;
    if (keys.length === 0) return;
    const sets = keys.map((k) => `${k} = ?`).join(", ") + ", updated_at = datetime('now')";
    const vals = keys.map((k) => partial[k]);
    db.prepare(`UPDATE guild_config SET ${sets} WHERE guild_id = ?`).run(...vals, guildId);
  }
  // Invalidate cache after a config update
  invalidateCache(guildId);
}

export function getConfig(guildId: string): GuildConfig | undefined {
  // Check cache 1st
  const cached = configCache.get(guildId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.config;
  }
  // Fetch from database
  const config = db.prepare("SELECT * FROM guild_config WHERE guild_id = ?").get(guildId) as
    | GuildConfig
    | undefined;

  // Cache the result if any
  if (config) {
    configCache.set(guildId, { config, timestamp: Date.now() });
  }
  return config;
}