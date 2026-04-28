/**
 * Role hierarchy and tier detection for the dashboard.
 * Mirrors src/lib/roles.ts from the bot — kept in sync manually.
 */

export const ROLE_IDS = {
	SERVER_OWNER: '896070888779317254',
	COMMUNITY_MANAGER: '1190093021170114680',
	COMMUNITY_DEV_LEAD: '1382242769468260352',
	SENIOR_ADMIN: '1420440472169746623',
	ADMINISTRATOR: '896070888779317248',
	SENIOR_MOD: '1095757038899953774',
	MODERATOR: '896070888762535975',
	JUNIOR_MOD: '896070888762535966',
	GATEKEEPER: '896070888762535969',
	MOD_TEAM: '987662057069482024',
	COMMUNITY_AMBASSADOR: '896070888762535967',
	SERVER_DEV: '1120074045883420753',
	SERVER_ARTIST: '896070888749940770'
} as const;

export const BOT_OWNER_UID = '697169405422862417';

/** Dashboard tiers (highest to lowest) matching the progressive reveal */
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

export const TIER_LABELS: Record<DashboardTier, string> = {
	owner: 'Owner / Dev',
	cm: 'Community Manager',
	cdl: 'Community Dev Lead',
	sa: 'Senior Administrator',
	admin: 'Administrator',
	sm: 'Senior Moderator',
	mod: 'Moderator',
	jm: 'Junior Moderator',
	gk: 'Gatekeeper',
	viewer: 'Mod Team (View Only)',
	none: 'No Access'
};

/**
 * Determine the highest dashboard tier for a user based on their roles.
 * Checks from highest to lowest — returns the first match.
 */
export function detectTier(roleIds: string[], userId: string): DashboardTier {
	// Bypass: Bot owner or Server Dev
	if (userId === BOT_OWNER_UID) return 'owner';
	if (roleIds.includes(ROLE_IDS.SERVER_DEV)) return 'owner';

	// Hierarchy check (highest first)
	if (roleIds.includes(ROLE_IDS.SERVER_OWNER)) return 'owner';
	if (roleIds.includes(ROLE_IDS.COMMUNITY_MANAGER)) return 'cm';
	if (roleIds.includes(ROLE_IDS.COMMUNITY_DEV_LEAD)) return 'cdl';
	if (roleIds.includes(ROLE_IDS.SENIOR_ADMIN)) return 'sa';
	if (roleIds.includes(ROLE_IDS.ADMINISTRATOR)) return 'admin';
	if (roleIds.includes(ROLE_IDS.SENIOR_MOD)) return 'sm';
	if (roleIds.includes(ROLE_IDS.MODERATOR)) return 'mod';
	if (roleIds.includes(ROLE_IDS.JUNIOR_MOD)) return 'jm';
	if (roleIds.includes(ROLE_IDS.GATEKEEPER)) return 'gk';
	if (roleIds.includes(ROLE_IDS.MOD_TEAM)) return 'viewer';
	if (roleIds.includes(ROLE_IDS.COMMUNITY_AMBASSADOR)) return 'viewer';
	if (roleIds.includes(ROLE_IDS.SERVER_ARTIST)) return 'viewer';

	return 'none';
}

/**
 * Check if user has the actual Gatekeeper role (not tier-based).
 * Review actions (claim/approve/reject/kick) are [GK] specific per PERMS-MATRIX.
 * Higher tiers can VIEW reviews but only GK role holders can ACT on them.
 * Admin+ can override unclaim (checked separately).
 */
export function isGatekeeper(roleIds: string[]): boolean {
	return roleIds.includes(ROLE_IDS.GATEKEEPER);
}

/** Check if a tier has at least the given minimum tier */
export function hasMinTier(userTier: DashboardTier, minTier: DashboardTier): boolean {
	const order: DashboardTier[] = ['owner', 'cm', 'cdl', 'sa', 'admin', 'sm', 'mod', 'jm', 'gk', 'viewer', 'none'];
	return order.indexOf(userTier) <= order.indexOf(minTier);
}
