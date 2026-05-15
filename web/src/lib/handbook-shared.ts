/**
 * Pawtropolis Tech — web/src/lib/handbook-shared.ts
 * WHAT: Client+server-safe constants and types for the handbook. Everything in
 *       `$lib/server/handbook/` is server-only; this is the runtime-shared
 *       counterpart so Svelte components can render tier labels without
 *       reaching across the server/client boundary.
 */

/** Mirror of DashboardTier from `$lib/server/roles` — duplicated here so this
 * file stays free of any `$lib/server/*` imports and can be used in both
 * Svelte components and server code without tripping SvelteKit's guard. Keep
 * the two definitions in sync. */
export type DashboardTier =
	| 'owner'
	| 'cm'
	| 'cdl'
	| 'sa'
	| 'admin'
	| 'sm'
	| 'mod'
	| 'jm'
	| 'gk'
	| 'viewer'
	| 'none';

export type HandbookTier = DashboardTier | 'public';

export const HANDBOOK_TIER_ORDER: HandbookTier[] = [
	'owner',
	'cm',
	'cdl',
	'sa',
	'admin',
	'sm',
	'mod',
	'jm',
	'gk',
	'viewer',
	'none',
	'public'
];

export const HANDBOOK_TIER_LABELS: Record<HandbookTier, string> = {
	owner: 'Owner / Dev',
	cm: 'Community Manager',
	cdl: 'Community Dev Lead',
	sa: 'Senior Administrator',
	admin: 'Administrator',
	sm: 'Senior Moderator',
	mod: 'Moderator',
	jm: 'Junior Moderator',
	gk: 'Gatekeeper',
	viewer: 'Mod Team / Ambassador',
	none: 'Signed in',
	public: 'Everyone'
};
