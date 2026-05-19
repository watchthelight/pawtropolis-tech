import { redirect } from "@sveltejs/kit";
import { hasMinTier, ROLE_IDS } from "$lib/server/roles";
import { getHomeMetrics } from "$lib/server/queries/home";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  if (!process.env.GUILD_ID) throw new Error("GUILD_ID environment variable is required");
  const user = locals.user!;

  // Artists without staff tier should land on the Art page, not the mod home
  const isArtist = (user.roles ?? []).includes(ROLE_IDS.SERVER_ARTIST);
  const isStaff = hasMinTier(user.tier, "gk");
  if (isArtist && !isStaff) {
    redirect(302, "/dashboard/art");
  }

  const includeModTier = hasMinTier(user.tier, "mod");
  const metrics = getHomeMetrics(user.id, process.env.GUILD_ID, includeModTier);

  return { metrics };
};
