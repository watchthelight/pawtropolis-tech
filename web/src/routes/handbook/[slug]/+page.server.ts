import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDoc } from '$lib/server/handbook';

export const load: PageServerLoad = async ({ params, locals }) => {
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
		isLoggedOut: result.isLoggedOut
	};
};
