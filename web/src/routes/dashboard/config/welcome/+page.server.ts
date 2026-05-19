import { error } from "@sveltejs/kit";
import { hasMinTier } from "$lib/server/roles";
import { db } from "$lib/server/db";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user || !hasMinTier(locals.user.tier, "admin")) {
    error(403, "You don't have permission to view this page.");
  }
  if (!process.env.GUILD_ID) throw new Error("GUILD_ID environment variable is required");

  const guildId = process.env.GUILD_ID;

  const row = db()
    .prepare(
      `SELECT welcome_template, info_channel_id, rules_channel_id, welcome_ping_role_id
			 FROM guild_config WHERE guild_id = ?`
    )
    .get(guildId) as
    | {
        welcome_template: string | null;
        info_channel_id: string | null;
        rules_channel_id: string | null;
        welcome_ping_role_id: string | null;
      }
    | undefined;

  // Approximate member count from user_cache so the preview embed shows a
  // realistic "This server now has N Users!" line. Falls back to 0 if the
  // cache is empty (fresh install).
  const memberRow = db()
    .prepare(`SELECT COUNT(DISTINCT user_id) as n FROM user_cache WHERE guild_id = ?`)
    .get(guildId) as { n: number } | undefined;

  return {
    template: row?.welcome_template ?? "",
    infoChannelId: row?.info_channel_id ?? null,
    rulesChannelId: row?.rules_channel_id ?? null,
    welcomePingRoleId: row?.welcome_ping_role_id ?? null,
    memberCount: memberRow?.n ?? 0,
    userTier: locals.user.tier,
  };
};
