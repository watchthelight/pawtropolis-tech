// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/features/badges/registry.ts
 * WHAT: Static, checked-in registry of every Discord role and channel
 *       referenced in the public docs.
 * WHY: Stable badge IDs in Markdown URLs survive role-ID reshuffles. The
 *       daily snapshot refresh keeps the rendered names + colors fresh.
 *
 * NOTE: GUILD_ID is a placeholder; resolver fills it from env at runtime.
 *       Source of truth for Discord IDs is docs/internal-info/ROLES.md
 *       and docs/internal-info/CHANNELS.md.
 */

import type { BadgeDefinition } from "./types.js";

// =============================================================================
// ROLES
// =============================================================================

// Movie tier (with suffix labels carried by the SVG)
const MOVIE_TIER_ROLES = [
  { id: "movie-tier-1", roleId: "1388676461657063505", suffix: "1+ movies" },
  { id: "movie-tier-2", roleId: "1388676662337736804", suffix: "5+ movies" },
  { id: "movie-tier-3", roleId: "1388675577778802748", suffix: "10+ movies" },
  { id: "movie-tier-4", roleId: "1388677466993987677", suffix: "20+ movies" },
] as const;

// Game tier
const GAME_TIER_ROLES = [
  { id: "game-tier-trophy-hunter", roleId: "1457127337215922367" },
  { id: "game-tier-key-masher", roleId: "1457127393377652942" },
  { id: "game-tier-night-builder", roleId: "1457127401887895594" },
] as const;

// Staff hierarchy (highest -> lowest)
const STAFF_ROLES = [
  { id: "role-community-founder", roleId: "896070888779317254" },
  { id: "role-community-manager", roleId: "1190093021170114680" },
  { id: "role-community-dev-lead", roleId: "1382242769468260352" },
  { id: "role-server-dev", roleId: "1120074045883420753" },
  { id: "role-senior-admin", roleId: "1420440472169746623" },
  { id: "role-administrator", roleId: "896070888779317248" },
  { id: "role-vrc-group-lead", roleId: "1408612908967006288" },
  { id: "role-senior-mod", roleId: "1095757038899953774" },
  { id: "role-moderator", roleId: "896070888762535975" },
  { id: "role-junior-mod", roleId: "896070888762535966" },
  { id: "role-community-staff", roleId: "987662057069482024" },
  { id: "role-gatekeeper", roleId: "896070888762535969" },
  { id: "role-community-ambassador", roleId: "896070888762535967" },
  { id: "role-events-manager", roleId: "1243805681904259124" },
  { id: "role-event-host", roleId: "1243805450835853383" },
  { id: "role-staff-emeritus", roleId: "896070888603136070" },
  { id: "role-community-contributor", roleId: "1397856960862486598" },
  { id: "role-og-citizen", roleId: "1235369854903648317" },
] as const;

// Artist verification
const ARTIST_ROLES = [
  { id: "role-server-artist", roleId: "896070888749940770" },
  { id: "role-verified-2d-artist", roleId: "896070888594759749" },
  { id: "role-verified-3d-artist", roleId: "1450218002149802146" },
  { id: "role-verified-music-artist", roleId: "1450217686805250218" },
  { id: "role-verified-fursuit-creator", roleId: "1450217866250031188" },
  { id: "role-og-verified-2d-artist", roleId: "1235365047115452557" },
] as const;

// Level progression
const LEVEL_ROLES = [
  { id: "role-fresh-fur-lvl0", roleId: "1459895384007512311" },
  { id: "role-newcomer-fur-lvl1", roleId: "896070888712175687" },
  { id: "role-beginner-fur-lvl5", roleId: "896070888712175688" },
  { id: "role-chatty-fur-lvl10", roleId: "896070888712175689" },
  { id: "role-engaged-fur-lvl15", roleId: "1280767926147878962" },
  { id: "role-active-fur-lvl20", roleId: "896070888712175690" },
  { id: "role-known-fur-lvl30", roleId: "896070888712175691" },
  { id: "role-experienced-fur-lvl40", roleId: "1216956340245631006" },
  { id: "role-noble-fur-lvl50", roleId: "896070888712175692" },
  { id: "role-veteran-fur-lvl60", roleId: "1214944241050976276" },
  { id: "role-elite-fur-lvl70", roleId: "1280766451208421407" },
  { id: "role-legendary-fur-lvl80", roleId: "1280766659539501117" },
  { id: "role-mythic-fur-lvl90", roleId: "1280766667999285329" },
  { id: "role-eternal-fur-lvl100", roleId: "896070888712175693" },
] as const;

// Roles with explicit Discord gradient color (Nitro feature). The runtime
// resolver picks up role.colors from discord.js when the API returns it; the
// entries below carry hand-curated overrides so the snapshot generator (no
// Discord call) can render them too.
const GRADIENT_ROLE_OVERRIDES: Record<
  string,
  { primary: string; secondary: string; tertiary?: string; holographic?: boolean }
> = {
  // Holographic role: ROYGBIV iridescent shimmer
  "role-holographic": {
    primary: "#FF6B6B",
    secondary: "#A855F7",
    tertiary: "#22D3EE",
    holographic: true,
  },
};

const HOLOGRAPHIC_ROLES = [
  { id: "role-holographic", roleId: "1385435356580548628" },
] as const;

// Patreon / boost / monetary
const SUPPORTER_ROLES = [
  { id: "role-booster-fur", roleId: "896074753004158987" },
  { id: "role-vip-fur", roleId: "896070888703803466" },
  { id: "role-patreon", roleId: "1004701361381834764" },
  { id: "role-donator", roleId: "1385437501488893972" },
] as const;

// AllByte + Byte token tiers
const TOKEN_ROLES = [
  { id: "role-allbyte-token-mythic", roleId: "1385195929459494952" },
  { id: "role-allbyte-token-legendary", roleId: "1385195806579097600" },
  { id: "role-allbyte-token-epic", roleId: "1385054283904323665" },
  { id: "role-byte-token-mythic", roleId: "1385195450856112198" },
  { id: "role-byte-token-legendary", roleId: "1385054324295733278" },
  { id: "role-byte-token-epic", roleId: "1385195081065173033" },
  { id: "role-byte-token-rare", roleId: "1385194838890119229" },
  { id: "role-byte-token-common", roleId: "1385194063841722439" },
] as const;

// Pings (notification opt-in)
const PING_ROLES = [
  { id: "role-announcements", roleId: "896070888653480063" },
  { id: "role-events", roleId: "896070888653480060" },
  { id: "role-giveaways", roleId: "896070888653480059" },
  { id: "role-polls", roleId: "1159636080627302531" },
] as const;

// =============================================================================
// CHANNELS
// =============================================================================

const CHANNELS = [
  // Main hangout
  { id: "channel-general", channelId: "896070889462976608" },
  { id: "channel-memes", channelId: "896070889462976610" },
  { id: "channel-yapping-space", channelId: "1393507326865969152" },
  // Creative Corner
  { id: "channel-writing", channelId: "1446602187655610461" },
  { id: "channel-artwork", channelId: "1400344550094012447" },
  { id: "channel-art-commissions", channelId: "1400346864947302461" },
  { id: "channel-gallery", channelId: "1130445124413956147" },
  // City Hall
  { id: "channel-tickets", channelId: "1103728856294236160" },
  { id: "channel-apply", channelId: "896070889005781041" },
  // Board
  { id: "channel-rules", channelId: "896070889005781038" },
  { id: "channel-roles", channelId: "1404710287084359710" },
  // Announcements
  { id: "channel-news", channelId: "896197065720332328" },
  { id: "channel-events-announce", channelId: "1231135837970890833" },
  { id: "channel-giveaways-announce", channelId: "1384456699888406679" },
  // Hobbies / Gaming
  { id: "channel-gaming", channelId: "1196698619689062430" },
  // Staff Room
  { id: "channel-reports", channelId: "1243820273610915880" },
  { id: "channel-mod-actions", channelId: "1383341031176802384" },
  // Staff Info
  { id: "channel-staff-news", channelId: "896070891539169317" },
  { id: "channel-appeals", channelId: "932485736366759977" },
  // Logs
  { id: "channel-staff-log", channelId: "1420410228905738332" },
] as const;

// =============================================================================
// COMPILE
// =============================================================================

function role(
  id: string,
  roleId: string,
  suffix?: string,
): BadgeDefinition {
  const grad = GRADIENT_ROLE_OVERRIDES[id];
  return {
    id,
    guildId: "",
    kind: "role",
    discordId: roleId,
    suffix,
    style: "discord-role",
    enabled: true,
    gradient: grad
      ? { primary: grad.primary, secondary: grad.secondary, tertiary: grad.tertiary }
      : undefined,
    holographic: grad?.holographic ?? false,
  };
}

function channel(id: string, channelId: string): BadgeDefinition {
  return {
    id,
    guildId: "",
    kind: "channel",
    discordId: channelId,
    style: "discord-channel",
    enabled: true,
  };
}

export const BADGE_REGISTRY: BadgeDefinition[] = [
  ...MOVIE_TIER_ROLES.map((r) => role(r.id, r.roleId, r.suffix)),
  ...GAME_TIER_ROLES.map((r) => role(r.id, r.roleId)),
  ...STAFF_ROLES.map((r) => role(r.id, r.roleId)),
  ...HOLOGRAPHIC_ROLES.map((r) => role(r.id, r.roleId)),
  ...ARTIST_ROLES.map((r) => role(r.id, r.roleId)),
  ...LEVEL_ROLES.map((r) => role(r.id, r.roleId)),
  ...SUPPORTER_ROLES.map((r) => role(r.id, r.roleId)),
  ...TOKEN_ROLES.map((r) => role(r.id, r.roleId)),
  ...PING_ROLES.map((r) => role(r.id, r.roleId)),
  ...CHANNELS.map((c) => channel(c.id, c.channelId)),
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
