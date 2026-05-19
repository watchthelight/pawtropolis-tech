import { error } from "@sveltejs/kit";
import { hasMinTier } from "$lib/server/roles";
import { getSecuritySnapshotFull } from "$lib/server/queries/auditSystems";
import type { PageServerLoad } from "./$types";

const GUILD_ID = process.env.GUILD_ID!;

export const load: PageServerLoad = async ({ params, parent }) => {
  const { userTier } = await parent();
  if (!hasMinTier(userTier, "sa")) {
    error(403, "You don't have permission to view this page.");
  }

  const id = parseInt(params.id, 10);
  if (isNaN(id)) error(400, "Invalid snapshot ID");

  const snapshot = getSecuritySnapshotFull(GUILD_ID, id);
  if (!snapshot) error(404, "Snapshot not found");

  return { snapshot };
};
