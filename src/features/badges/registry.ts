// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/features/badges/registry.ts
 * WHAT: Static, checked-in registry of badges that documentation references.
 * WHY: We want stable badge IDs in Markdown URLs so docs do not break when
 *      role IDs are reshuffled. The registry maps friendly IDs to the
 *      Discord IDs the bot resolves at refresh time.
 *
 * NOTE: GUILD_ID is intentionally a placeholder; the resolver fills it from
 *       env at runtime. Keeping it empty here avoids hard-coding the
 *       primary guild ID into a public file.
 */

import type { BadgeDefinition } from "./types.js";

/**
 * Movie tier role IDs sourced from docs/MOD-QUICKREF.md and
 * docs/BOT-HANDBOOK.md. These IDs change rarely; the daily refresh is what
 * keeps the rendered names and colors fresh.
 */
const MOVIE_TIER_ROLES = [
  { id: "movie-tier-1", roleId: "1388676461657063505", suffix: "1+ movies" },
  { id: "movie-tier-2", roleId: "1388676662337736804", suffix: "5+ movies" },
  { id: "movie-tier-3", roleId: "1388675577778802748", suffix: "10+ movies" },
  { id: "movie-tier-4", roleId: "1388677466993987677", suffix: "20+ movies" },
] as const;

const NOTABLE_ROLES = [
  { id: "role-server-artist", roleId: "1201395606455562341" },
] as const;

const NOTABLE_CHANNELS = [
  { id: "channel-writing", channelId: "1446602187655610461" },
  { id: "channel-yapping-space", channelId: "1393507326865969152" },
  { id: "channel-memes", channelId: "896070889462976610" },
] as const;

export const BADGE_REGISTRY: BadgeDefinition[] = [
  ...MOVIE_TIER_ROLES.map<BadgeDefinition>((r) => ({
    id: r.id,
    guildId: "",
    kind: "role",
    discordId: r.roleId,
    suffix: r.suffix,
    style: "discord-role",
    enabled: true,
  })),
  ...NOTABLE_ROLES.map<BadgeDefinition>((r) => ({
    id: r.id,
    guildId: "",
    kind: "role",
    discordId: r.roleId,
    style: "discord-role",
    enabled: true,
  })),
  ...NOTABLE_CHANNELS.map<BadgeDefinition>((c) => ({
    id: c.id,
    guildId: "",
    kind: "channel",
    discordId: c.channelId,
    style: "discord-channel",
    enabled: true,
  })),
];

const REGISTRY_BY_ID = new Map(BADGE_REGISTRY.map((b) => [b.id, b]));

export function getBadgeDefinition(id: string): BadgeDefinition | undefined {
  return REGISTRY_BY_ID.get(id);
}

export function listBadgeDefinitions(): BadgeDefinition[] {
  return BADGE_REGISTRY.filter((b) => b.enabled);
}

export function assertNoDuplicateIds(defs: BadgeDefinition[] = BADGE_REGISTRY): void {
  const seen = new Set<string>();
  for (const d of defs) {
    if (seen.has(d.id)) {
      throw new Error(`badge registry duplicate id: ${d.id}`);
    }
    seen.add(d.id);
  }
}
