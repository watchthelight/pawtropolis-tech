/**
 * Soft-auth: /handbook is reachable by everyone. We pass through whatever
 * `event.locals.user` (set in hooks.server.ts) gives us, even null, and let
 * the page render public-tier content for signed-out visitors.
 */

import type { LayoutServerLoad } from "./$types";
import { listDocs } from "$lib/server/handbook";

export const load: LayoutServerLoad = async ({ locals }) => {
  const user = locals.user ?? null;
  const tier = user?.tier ?? null;
  const docs = listDocs({ tier });
  return { user, tier, docs };
};
