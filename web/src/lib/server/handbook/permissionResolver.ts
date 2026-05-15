/**
 * Pawtropolis Tech — web/src/lib/server/handbook/permissionResolver.ts
 * WHAT: Parses inline permission prose like "**Who can use it:** Senior Mod+"
 *       into a structured tier requirement so the handbook can render the right
 *       "you can / you can't run this" badge for every viewer.
 * WHY: BOT-HANDBOOK and the role guides describe permissions in free-form
 *      English. The dashboard already has a strict `DashboardTier` ladder; this
 *      module is the bridge between the two.
 */

import type { DashboardTier } from '../roles';

/**
 * Extended tier that adds `public` (anyone, including not signed in) to the
 * dashboard's ladder. Used inside the handbook only.
 */
export type HandbookTier = DashboardTier | 'public';

/** Order from highest (most-privileged) to lowest. `public` sits below `none`. */
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

/**
 * Whether a viewer with `userTier` meets a section's `requiredTier`. Lower
 * index in HANDBOOK_TIER_ORDER means more privileged, so the viewer must sit
 * at or above (numerically <=) the requirement.
 */
export function meetsTier(userTier: HandbookTier, requiredTier: HandbookTier): boolean {
	const u = HANDBOOK_TIER_ORDER.indexOf(userTier);
	const r = HANDBOOK_TIER_ORDER.indexOf(requiredTier);
	return u !== -1 && r !== -1 && u <= r;
}

/** Discord-level permissions that sometimes appear instead of a tier. */
export type DiscordPerm =
	| 'MANAGE_MESSAGES'
	| 'MANAGE_GUILD'
	| 'MANAGE_ROLES'
	| 'ADMINISTRATOR';

export type PermissionRequirement = {
	/** Minimum tier the viewer must hold. */
	tier: HandbookTier;
	/** Some commands use `[GK]` notation meaning "GK exclusively, not GK+". */
	exactOnly: boolean;
	/** Discord permission that may grant access in addition to (or instead of) the tier. */
	discordPerm: DiscordPerm | null;
	/** Original prose for tooltips / accessibility. */
	raw: string;
};

/**
 * Match-table ordered from most-privileged to least so the first match in a
 * compound statement (e.g. "Admin+ or Community Ambassador") becomes the
 * minimum tier the section needs. `lookahead` is required to avoid matching
 * "Senior" inside "Senior Mod" when scanning for "Senior Admin".
 */
const TIER_PATTERNS: Array<{ tier: HandbookTier; regex: RegExp; exactOnly?: boolean }> = [
	{ tier: 'owner', regex: /\b(?:Bot Owner|Server Dev|Owner only)\b/i },
	{ tier: 'cm', regex: /\b(?:Community Manager|CM\+?)\b/i },
	{ tier: 'cdl', regex: /\b(?:Community Dev(?:elopment)? Lead|CDL\+?)\b/i },
	{ tier: 'sa', regex: /\b(?:Senior Admin(?:istrator)?\+?|SA\+?)\b/i },
	{ tier: 'admin', regex: /\b(?:Administrator\+?|Admin\+?|A\+)\b/i },
	{ tier: 'sm', regex: /\b(?:Senior Mod(?:erator)?\+?|SM\+?)\b/i },
	{ tier: 'mod', regex: /\b(?:Moderator\+?|^M\+)\b/i },
	{ tier: 'jm', regex: /\b(?:Junior Mod(?:erator)?\+?|JM\+?)\b/i },
	{ tier: 'gk', regex: /\bGatekeeper\+?|\bGK\+?\b/i },
	{ tier: 'gk', regex: /\[GK\]/, exactOnly: true },
	// Bare "Staff" with no role qualifier means "anyone with a staff role" — treat as Gatekeeper+.
	{ tier: 'gk', regex: /(?<![\w-])Staff(?![\w-])/i },
	{ tier: 'viewer', regex: /\b(?:Community Ambassador|Mod Team|Server Artist)\b/i },
	// Public matchers are intentionally strict: bare "Anyone" / "Any user" would
	// catch words like "anyone's" inside descriptive prose ("Admin+ can unclaim
	// anyone's").
	{ tier: 'public', regex: /\bEveryone\b/i },
	{ tier: 'public', regex: /\bPublic\b/i },
	{ tier: 'public', regex: /\bAnyone can\b/i }
];

const DISCORD_PERM_PATTERNS: Array<{ perm: DiscordPerm; regex: RegExp }> = [
	{ perm: 'MANAGE_MESSAGES', regex: /\bManage[\s-]?Messages\b/i },
	{ perm: 'MANAGE_GUILD', regex: /\bManage[\s-]?Guild\b/i },
	{ perm: 'MANAGE_ROLES', regex: /\bManage[\s-]?Roles\b/i },
	{ perm: 'ADMINISTRATOR', regex: /\bAdministrator perm(?:ission)?\b/i }
];

/**
 * Parse a "Who can use it" line. Returns `null` if no permission language
 * matched at all — callers can treat that as "unknown" and fall back to the
 * doc's default tier.
 *
 * Hybrid statements (e.g. "Manage Roles OR Community Ambassador OR Mod Team")
 * resolve to the **lowest** tier match because that's who can actually run the
 * command; the higher tier could too, but anyone meeting the floor passes.
 */
export function parsePermissionLine(raw: string): PermissionRequirement | null {
	const text = raw.replace(/\*\*/g, '').trim();
	if (!text) return null;

	const tiersFound: Array<{ tier: HandbookTier; exactOnly: boolean }> = [];
	for (const { tier, regex, exactOnly } of TIER_PATTERNS) {
		if (regex.test(text)) {
			tiersFound.push({ tier, exactOnly: exactOnly === true });
		}
	}

	let discordPerm: DiscordPerm | null = null;
	for (const { perm, regex } of DISCORD_PERM_PATTERNS) {
		if (regex.test(text)) {
			discordPerm = perm;
			break;
		}
	}

	if (tiersFound.length === 0 && !discordPerm) return null;

	const minTier = tiersFound.length
		? tiersFound.reduce((lowest, candidate) => {
				const li = HANDBOOK_TIER_ORDER.indexOf(lowest.tier);
				const ci = HANDBOOK_TIER_ORDER.indexOf(candidate.tier);
				return ci > li ? candidate : lowest;
			}).tier
		: discordPermFallbackTier(discordPerm);

	const exactOnly = tiersFound.some((t) => t.exactOnly);

	return {
		tier: minTier,
		exactOnly,
		discordPerm,
		raw
	};
}

function discordPermFallbackTier(perm: DiscordPerm | null): HandbookTier {
	switch (perm) {
		case 'ADMINISTRATOR':
		case 'MANAGE_GUILD':
		case 'MANAGE_ROLES':
			return 'admin';
		case 'MANAGE_MESSAGES':
			return 'mod';
		default:
			return 'public';
	}
}

/**
 * Strip the leading "Who can use it:" prefix (with or without the bold
 * asterisks) so callers can feed `parsePermissionLine` raw paragraph text.
 */
export function stripWhoCanUseItPrefix(line: string): string | null {
	const m = line.match(/^\*\*Who can use it:\*\*\s*(.+)$/i)
		?? line.match(/^Who can use it:\s*(.+)$/i);
	return m ? m[1] : null;
}
