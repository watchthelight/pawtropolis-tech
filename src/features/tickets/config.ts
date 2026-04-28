/**
 * Pawtropolis Tech -- src/features/tickets/config.ts
 * WHAT: Resolves per-guild infrastructure IDs (Tickets category, panel channel,
 *       Community Ambassador / Mod Team role IDs) for the ticket system.
 * WHY: Ticket service needs these to create channels under the right category
 *      and post panels in the right room. We hardcode the production guild
 *      values; other guilds (test, future) supply their own via env vars.
 *      Future evolution: move into guild_config columns once admin UI exists.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

const PROD_GUILD_ID = "896070888594759740";

const PROD_TICKETS_CATEGORY_ID = "1103734436291412099";
const PROD_PANEL_CHANNEL_ID = "1103728856294236160";

export const COMMUNITY_AMBASSADOR_ROLE_ID = "896070888762535967";
export const MOD_TEAM_ROLE_ID = "987662057069482024";

/** Tickets category ID for the given guild, or null if unconfigured. */
export function getTicketsCategoryId(guildId: string): string | null {
  if (guildId === PROD_GUILD_ID) return PROD_TICKETS_CATEGORY_ID;
  const fromEnv = process.env.TICKETS_CATEGORY_ID?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
}

/** Channel where panel embeds live, for the given guild, or null if unconfigured. */
export function getPanelChannelId(guildId: string): string | null {
  if (guildId === PROD_GUILD_ID) return PROD_PANEL_CHANNEL_ID;
  const fromEnv = process.env.TICKETS_PANEL_CHANNEL_ID?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
}

/** Marker used in panel embed footer so /postticketpanel can find/edit prior posts idempotently. */
export const PANEL_FOOTER_MARKER = "Pawtropolis Ticket System";
