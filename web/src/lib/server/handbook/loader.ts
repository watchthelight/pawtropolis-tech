/**
 * Pawtropolis Tech — web/src/lib/server/handbook/loader.ts
 * WHAT: Reads every handbook .md file once at startup and caches the marked
 *       token tree per slug. Provides hot-reload in dev so editing a doc on
 *       disk refreshes the handbook without restarting the server.
 * WHY: Parsing ~220 KB of markdown on every page request would be wasteful and
 *      visible. A single startup parse is ~50 ms; the cache survives until
 *      the server restarts.
 */

import { readFileSync, statSync, watch } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked, type Token } from 'marked';
import type { HandbookTier } from './permissionResolver';

export type DocSlug =
	| 'bot-handbook'
	| 'mod-handbook'
	| 'perms-matrix'
	| 'gatekeeper-guide'
	| 'moderator-guide'
	| 'admin-guide'
	| 'leadership-guide'
	| 'mod-quickref'
	| 'ticket-system'
	| 'slash-commands';

export type DocMeta = {
	slug: DocSlug;
	title: string;
	/** Default tier for sections that don't carry their own "Who can use it" line. */
	defaultTier: HandbookTier;
	/** Source path relative to repo root. */
	sourcePath: string;
	/** Short one-line description shown in the doc index. */
	tagline: string;
};

export const DOC_REGISTRY: DocMeta[] = [
	{
		slug: 'bot-handbook',
		title: 'Bot Handbook',
		defaultTier: 'public',
		sourcePath: 'docs/BOT-HANDBOOK.md',
		tagline: 'Every slash command, its options, who can run it, and how to use it.'
	},
	{
		slug: 'mod-handbook',
		title: 'Moderator Handbook',
		defaultTier: 'gk',
		sourcePath: 'docs/MOD-HANDBOOK.md',
		tagline: 'Staff policies, verification procedures, escalation, cross-banning.'
	},
	{
		slug: 'perms-matrix',
		title: 'Permissions Matrix',
		defaultTier: 'public',
		sourcePath: 'docs/PERMS-MATRIX.md',
		tagline: 'Role hierarchy and which tier can run each command.'
	},
	{
		slug: 'gatekeeper-guide',
		title: 'Gatekeeper Guide',
		defaultTier: 'gk',
		sourcePath: 'docs/GATEKEEPER-GUIDE.md',
		tagline: 'Onboarding for Gatekeepers: accept, reject, listopen workflow.'
	},
	{
		slug: 'moderator-guide',
		title: 'Moderator Guide',
		defaultTier: 'mod',
		sourcePath: 'docs/MODERATOR-GUIDE.md',
		tagline: 'Day-to-day moderation tooling and policies.'
	},
	{
		slug: 'admin-guide',
		title: 'Admin Guide',
		defaultTier: 'admin',
		sourcePath: 'docs/ADMIN-GUIDE.md',
		tagline: 'Configuration, audit, cleanup, role recovery.'
	},
	{
		slug: 'leadership-guide',
		title: 'Leadership Guide',
		defaultTier: 'cm',
		sourcePath: 'docs/LEADERSHIP-GUIDE.md',
		tagline: 'Server-wide management: backfill, database recovery, migrations.'
	},
	{
		slug: 'mod-quickref',
		title: 'Mod Quick Reference',
		defaultTier: 'gk',
		sourcePath: 'docs/MOD-QUICKREF.md',
		tagline: 'Cheat sheet for the most-used moderation commands.'
	},
	{
		slug: 'ticket-system',
		title: 'Ticket System Guide',
		defaultTier: 'gk',
		sourcePath: 'docs/TICKET-SYSTEM-GUIDE.md',
		tagline: 'First-party tickets: panel, close, manual reassign.'
	},
	{
		slug: 'slash-commands',
		title: 'Slash Commands (Quick)',
		defaultTier: 'public',
		sourcePath: 'docs/reference/slash-commands.md',
		tagline: 'Short index pointing into the Bot Handbook.'
	}
];

/** Repo root, derived from this file's location. `web/src/lib/server/handbook/loader.ts` → up four. */
const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');

type CacheEntry = {
	tokens: Token[];
	raw: string;
	mtimeMs: number;
};

const cache = new Map<DocSlug, CacheEntry>();

function readDoc(meta: DocMeta): CacheEntry {
	const absPath = resolvePath(REPO_ROOT, meta.sourcePath);
	const raw = readFileSync(absPath, 'utf8');
	const tokens = marked.lexer(raw, { gfm: true });
	const stat = statSync(absPath);
	return { tokens, raw, mtimeMs: stat.mtimeMs };
}

/**
 * Eagerly load every doc at startup. Called once from `index.ts` on first use
 * (so cold-start cost lands on the first /handbook request rather than every
 * server boot, regardless of whether anyone visits the page).
 */
export function preloadAll(): void {
	for (const meta of DOC_REGISTRY) {
		if (!cache.has(meta.slug)) {
			cache.set(meta.slug, readDoc(meta));
		}
	}
	if (process.env.NODE_ENV !== 'production') {
		setupDevWatchers();
	}
}

let devWatchersInstalled = false;
function setupDevWatchers() {
	if (devWatchersInstalled) return;
	devWatchersInstalled = true;
	for (const meta of DOC_REGISTRY) {
		const absPath = resolvePath(REPO_ROOT, meta.sourcePath);
		try {
			watch(absPath, { persistent: false }, () => {
				try {
					cache.set(meta.slug, readDoc(meta));
				} catch {
					// Editor save races (rename + replace) sometimes throw transient ENOENT.
					// Next access will re-read on demand.
					cache.delete(meta.slug);
				}
			});
		} catch {
			// File may not exist (slash-commands.md was once renamed); skip silently.
		}
	}
}

export function getRawTokens(slug: DocSlug): Token[] {
	const cached = cache.get(slug);
	if (cached) return cached.tokens;
	const meta = DOC_REGISTRY.find((d) => d.slug === slug);
	if (!meta) throw new Error(`Unknown handbook slug: ${slug}`);
	const fresh = readDoc(meta);
	cache.set(slug, fresh);
	return fresh.tokens;
}

export function getDocMeta(slug: DocSlug): DocMeta | undefined {
	return DOC_REGISTRY.find((d) => d.slug === slug);
}
