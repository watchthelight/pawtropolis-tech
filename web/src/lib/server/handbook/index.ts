/**
 * Pawtropolis Tech — web/src/lib/server/handbook/index.ts
 * WHAT: Public API for the /handbook routes. Provides one function per page
 *       concern: `getDoc(slug, tier)`, `listDocs()`, `getSearchIndex(tier)`.
 * WHY: Routes shouldn't reach into loader/decorator directly — keeping the
 *      surface narrow makes future swaps (e.g. moving the parse step to a
 *      build hook) painless.
 */

import {
	DOC_REGISTRY,
	getDocMeta,
	getRawTokens,
	preloadAll,
	type DocMeta,
	type DocSlug
} from './loader';
import { decorate, resetSlugCounter, type DecoratedDoc } from './decorator';
import { meetsTier, type HandbookTier } from './permissionResolver';
import type { DashboardTier } from '../roles';

let preloaded = false;

function ensurePreloaded() {
	if (!preloaded) {
		preloadAll();
		preloaded = true;
	}
}

/**
 * Render a single doc for one viewer. Returns `null` if the slug is unknown
 * so route loaders can throw a 404.
 */
export function getDoc(slug: string, viewer: { tier: DashboardTier | null }): {
	meta: DocMeta;
	doc: DecoratedDoc;
	viewerTier: HandbookTier;
	isLoggedOut: boolean;
} | null {
	ensurePreloaded();
	const meta = getDocMeta(slug as DocSlug);
	if (!meta) return null;

	const isLoggedOut = viewer.tier === null;
	const viewerTier: HandbookTier = viewer.tier === null ? 'public' : viewer.tier;

	resetSlugCounter();
	const tokens = getRawTokens(meta.slug);
	const doc = decorate(tokens, meta, viewerTier, isLoggedOut);

	return { meta, doc, viewerTier, isLoggedOut };
}

/**
 * Doc index for the landing / sidebar. Each row includes a `canAccess` hint
 * so the index can dim entries the viewer can't open without signing in.
 */
export function listDocs(viewer: { tier: DashboardTier | null }) {
	ensurePreloaded();
	const isLoggedOut = viewer.tier === null;
	const viewerTier: HandbookTier = viewer.tier === null ? 'public' : viewer.tier;
	return DOC_REGISTRY.map((meta) => ({
		slug: meta.slug,
		title: meta.title,
		tagline: meta.tagline,
		defaultTier: meta.defaultTier,
		canAccess: meetsTier(viewerTier, meta.defaultTier),
		isLockedForLoggedOut: isLoggedOut && meta.defaultTier !== 'public'
	}));
}

/**
 * Flat list of `{ slug, headingText, headingPath, docTitle, tier }` triples
 * for the client-side fuzzy search. Generated lazily on first call.
 */
let searchCache: Array<{
	docSlug: DocSlug;
	docTitle: string;
	headingSlug: string;
	headingText: string;
	tier: HandbookTier;
}> | null = null;

export function getSearchIndex(viewer: { tier: DashboardTier | null }) {
	ensurePreloaded();
	if (!searchCache) {
		searchCache = [];
		for (const meta of DOC_REGISTRY) {
			resetSlugCounter();
			const tokens = getRawTokens(meta.slug);
			// Decorate as a notional `owner` so we walk every section even if it's
			// locked for non-staff; we filter visibility per-viewer below.
			const decorated = decorate(tokens, meta, 'owner', false);
			for (const entry of decorated.tocEntries) {
				searchCache.push({
					docSlug: meta.slug,
					docTitle: meta.title,
					headingSlug: entry.slug,
					headingText: entry.text,
					tier: entry.tier
				});
			}
		}
	}
	const isLoggedOut = viewer.tier === null;
	const viewerTier: HandbookTier = viewer.tier === null ? 'public' : viewer.tier;
	return searchCache.filter((row) => {
		if (isLoggedOut && row.tier !== 'public') return false;
		return meetsTier(viewerTier, row.tier);
	});
}
