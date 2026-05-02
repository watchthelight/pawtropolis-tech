// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/features/badges/resolve.ts
 * WHAT: Resolve a BadgeDefinition to a ResolvedBadge using a Discord client.
 * WHY: We need real names + colors at refresh time but must keep the prior
 *      cached state on failure so docs do not flip to "unknown" because of
 *      a transient API hiccup.
 *
 * The resolver is intentionally tolerant: it never throws to the caller.
 * Callers branch on `stale` to decide whether to keep the prior manifest
 * entry or accept the freshly resolved one.
 */

import type { Client, Guild, Role, GuildBasedChannel, User } from "discord.js";
import { logger } from "../../lib/logger.js";
import {
  DISCORD_BLURPLE,
  DISCORD_NEUTRAL_PILL,
  intToHex,
  normalizeHex,
  readableTextOn,
  tintForPill,
} from "./color.js";
import type {
  BadgeDefinition,
  BadgeManifestEntry,
  ResolvedBadge,
} from "./types.js";

export type ResolveContext = {
  client: Client;
  guildId: string;
  prior?: BadgeManifestEntry;
};

function nowIso(): string {
  return new Date().toISOString();
}

function staleFromPrior(
  def: BadgeDefinition,
  ctx: ResolveContext,
  reason: string,
): ResolvedBadge {
  if (ctx.prior) {
    return { ...ctx.prior, stale: true, resolvedAt: nowIso() };
  }
  const fallbackName =
    def.label || (def.kind === "channel" ? "unknown-channel" : "unknown-role");
  const prefix: ResolvedBadge["prefix"] =
    def.kind === "channel" ? "#" : def.kind === "user" ? "@" : def.kind === "role" ? "@" : "";
  logger.warn(
    { evt: "badge_resolve_fallback", id: def.id, kind: def.kind, reason },
    "[badges] resolve fallback",
  );
  return {
    id: def.id,
    kind: def.kind,
    guildId: ctx.guildId,
    discordId: def.discordId,
    displayName: fallbackName,
    prefix,
    suffix: def.suffix,
    colorHex: DISCORD_BLURPLE,
    backgroundHex: DISCORD_NEUTRAL_PILL,
    foregroundHex: readableTextOn(DISCORD_NEUTRAL_PILL),
    linkUrl: def.linkUrl,
    stale: true,
    resolvedAt: nowIso(),
  };
}

async function fetchGuild(client: Client, guildId: string): Promise<Guild | null> {
  try {
    const cached = client.guilds.cache.get(guildId);
    if (cached) return cached;
    return await client.guilds.fetch(guildId);
  } catch {
    return null;
  }
}

async function resolveRole(
  def: BadgeDefinition,
  ctx: ResolveContext,
): Promise<ResolvedBadge> {
  if (!def.discordId) return staleFromPrior(def, ctx, "no_discord_id");
  const guild = await fetchGuild(ctx.client, ctx.guildId);
  if (!guild) return staleFromPrior(def, ctx, "no_guild");
  let role: Role | null = guild.roles.cache.get(def.discordId) ?? null;
  if (!role) {
    try {
      role = await guild.roles.fetch(def.discordId);
    } catch {
      role = null;
    }
  }
  if (!role) return staleFromPrior(def, ctx, "role_missing");

  const colorHex = intToHex(role.color);
  const bg = tintForPill(colorHex, 0.28);
  // Discord 2024 added two/three-stop gradient roles. discord.js may not
  // type role.colors yet, so probe defensively.
  const colors = (role as unknown as {
    colors?: {
      primary_color?: number;
      secondary_color?: number | null;
      tertiary_color?: number | null;
    };
  }).colors;
  const gradient =
    colors && colors.secondary_color != null
      ? {
          primary: intToHex(colors.primary_color),
          secondary: intToHex(colors.secondary_color),
          tertiary:
            colors.tertiary_color != null ? intToHex(colors.tertiary_color) : undefined,
        }
      : def.gradient;
  return {
    id: def.id,
    kind: "role",
    guildId: ctx.guildId,
    discordId: def.discordId,
    displayName: role.name,
    prefix: "@",
    suffix: def.suffix,
    colorHex,
    backgroundHex: bg,
    foregroundHex: readableTextOn(bg),
    linkUrl: def.linkUrl,
    stale: false,
    resolvedAt: nowIso(),
    gradient,
    holographic: def.holographic,
  };
}

async function resolveChannel(
  def: BadgeDefinition,
  ctx: ResolveContext,
): Promise<ResolvedBadge> {
  if (!def.discordId) return staleFromPrior(def, ctx, "no_discord_id");
  const guild = await fetchGuild(ctx.client, ctx.guildId);
  if (!guild) return staleFromPrior(def, ctx, "no_guild");
  let channel: GuildBasedChannel | null =
    guild.channels.cache.get(def.discordId) ?? null;
  if (!channel) {
    try {
      channel = await guild.channels.fetch(def.discordId);
    } catch {
      channel = null;
    }
  }
  if (!channel) return staleFromPrior(def, ctx, "channel_missing");

  return {
    id: def.id,
    kind: "channel",
    guildId: ctx.guildId,
    discordId: def.discordId,
    displayName: channel.name ?? "channel",
    prefix: "#",
    suffix: def.suffix,
    colorHex: DISCORD_BLURPLE,
    backgroundHex: DISCORD_NEUTRAL_PILL,
    foregroundHex: readableTextOn(DISCORD_NEUTRAL_PILL),
    linkUrl: def.linkUrl,
    stale: false,
    resolvedAt: nowIso(),
  };
}

async function resolveUser(
  def: BadgeDefinition,
  ctx: ResolveContext,
): Promise<ResolvedBadge> {
  if (!def.discordId) return staleFromPrior(def, ctx, "no_discord_id");
  let user: User | null = null;
  try {
    user = await ctx.client.users.fetch(def.discordId);
  } catch {
    user = null;
  }
  if (!user) return staleFromPrior(def, ctx, "user_missing");
  const display = user.globalName || user.username;
  return {
    id: def.id,
    kind: "user",
    guildId: ctx.guildId,
    discordId: def.discordId,
    displayName: display,
    prefix: "@",
    suffix: def.suffix,
    colorHex: DISCORD_BLURPLE,
    backgroundHex: DISCORD_NEUTRAL_PILL,
    foregroundHex: readableTextOn(DISCORD_NEUTRAL_PILL),
    linkUrl: def.linkUrl,
    stale: false,
    resolvedAt: nowIso(),
  };
}

function resolveCustom(
  def: BadgeDefinition,
  ctx: ResolveContext,
): ResolvedBadge {
  const label = def.label || def.id;
  const colorHex = normalizeHex(undefined);
  const bg = tintForPill(colorHex, 0.32);
  return {
    id: def.id,
    kind: "custom",
    guildId: ctx.guildId,
    displayName: label,
    prefix: "",
    suffix: def.suffix,
    colorHex,
    backgroundHex: bg,
    foregroundHex: readableTextOn(bg),
    linkUrl: def.linkUrl,
    stale: false,
    resolvedAt: nowIso(),
  };
}

export async function resolveBadge(
  def: BadgeDefinition,
  ctx: ResolveContext,
): Promise<ResolvedBadge> {
  try {
    switch (def.kind) {
      case "role":
        return await resolveRole(def, ctx);
      case "channel":
        return await resolveChannel(def, ctx);
      case "user":
        return await resolveUser(def, ctx);
      case "custom":
        return resolveCustom(def, ctx);
      default:
        return staleFromPrior(def, ctx, "unknown_kind");
    }
  } catch (err) {
    logger.warn(
      { evt: "badge_resolve_error", id: def.id, err: (err as Error).message },
      "[badges] resolve threw",
    );
    return staleFromPrior(def, ctx, "exception");
  }
}
