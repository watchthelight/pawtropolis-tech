import { error } from "@sveltejs/kit";
import { hasMinTier } from "$lib/server/roles";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.user || !hasMinTier(locals.user.tier, "admin")) {
    error(403, "You don't have permission to view this page.");
  }
  return { userTier: locals.user.tier };
};
