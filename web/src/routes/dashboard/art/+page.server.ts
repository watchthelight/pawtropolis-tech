import { error } from "@sveltejs/kit";
import { hasMinTier, ROLE_IDS } from "$lib/server/roles";
import {
  getArtistQueue,
  getActiveJobs,
  getJobHistory,
  getLeaderboard,
} from "$lib/server/queries/art";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) error(401, "Not authenticated");

  if (!process.env.GUILD_ID) throw new Error("GUILD_ID environment variable is required");

  const isArtist = (locals.user.roles ?? []).includes(ROLE_IDS.SERVER_ARTIST);
  const isStaff = hasMinTier(locals.user.tier, "sm");

  if (!isArtist && !isStaff) {
    error(403, "You don't have permission to view this page.");
  }

  const guildId = process.env.GUILD_ID;
  const activeJobs = getActiveJobs(guildId);

  // Artist's own jobs (always loaded for both roles)
  const myJobs = activeJobs.filter((j) => j.artistId === locals.user!.id);

  const queue = getArtistQueue(guildId);
  const jobHistory = getJobHistory(guildId, 1, 20);
  const monthlyLeaderboard = getLeaderboard(guildId, "monthly", 10);
  const allTimeLeaderboard = getLeaderboard(guildId, "alltime", 10);

  return {
    isArtist,
    isStaff,
    queue,
    activeJobs,
    myJobs,
    jobHistory,
    monthlyLeaderboard,
    allTimeLeaderboard,
  };
};
