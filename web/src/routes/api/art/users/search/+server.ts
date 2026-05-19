import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { hasMinTier, ROLE_IDS } from "$lib/server/roles";
import { searchUsers } from "$lib/server/queries/art";

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.user) error(401, "Not authenticated");

  const isStaff = hasMinTier(locals.user.tier, "sm");
  const isArtist = (locals.user.roles ?? []).includes(ROLE_IDS.SERVER_ARTIST);
  if (!isStaff && !isArtist) error(403, "Insufficient permissions");

  if (!process.env.GUILD_ID) throw new Error("GUILD_ID environment variable is required");

  const q = url.searchParams.get("q") ?? "";
  if (q.length < 1) return json({ success: true, data: { users: [] } });

  const excludeArtists = url.searchParams.get("excludeArtists") === "true";
  const users = searchUsers(process.env.GUILD_ID, q, excludeArtists, 10);

  return json({ success: true, data: { users } });
};
