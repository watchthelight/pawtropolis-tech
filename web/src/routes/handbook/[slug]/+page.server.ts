import { error, redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { getDoc } from "$lib/server/handbook";
import { HANDBOOK_FILENAME_TO_SLUG } from "$lib/handbook-shared";

export const load: PageServerLoad = async ({ params, locals }) => {
  // Stale bookmark? `/handbook/MOD-HANDBOOK.md` → `/handbook/mod-handbook`.
  // The hash from the original URL is preserved by the browser when it
  // follows the 308, so anchor jumps survive automatically.
  const filenameMatch =
    HANDBOOK_FILENAME_TO_SLUG[params.slug] ??
    HANDBOOK_FILENAME_TO_SLUG[params.slug.toUpperCase()] ??
    HANDBOOK_FILENAME_TO_SLUG[params.slug.toLowerCase()];
  if (filenameMatch) {
    throw redirect(308, `/handbook/${filenameMatch}`);
  }

  const user = locals.user ?? null;
  const tier = user?.tier ?? null;
  const result = getDoc(params.slug, { tier });
  if (!result) {
    throw error(404, `Handbook section "${params.slug}" not found.`);
  }
  return {
    slug: result.meta.slug,
    title: result.meta.title,
    tagline: result.meta.tagline,
    defaultTier: result.meta.defaultTier,
    tokens: result.doc.tokens,
    toc: result.doc.tocEntries,
    viewerTier: result.viewerTier,
    isLoggedOut: result.isLoggedOut,
  };
};
