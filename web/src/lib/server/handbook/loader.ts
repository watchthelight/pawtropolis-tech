/**
 * Pawtropolis Tech — web/src/lib/server/handbook/loader.ts
 * WHAT: Bundles each handbook .md file into the SvelteKit build via Vite's
 *       `?raw` import, then tokenises them lazily on first access (or
 *       eagerly on `preloadAll()`).
 * WHY: The previous fs.readFileSync approach didn't survive deployment —
 *      EC2's `web/build/` doesn't ship with the repo's `docs/` directory.
 *      Inlining the markdown as string literals at build time makes the
 *      bundle self-contained.
 */

import { marked, type Token } from "marked";
import type { HandbookTier } from "../../handbook-shared";

import BOT_HANDBOOK from "../../../../../docs/BOT-HANDBOOK.md?raw";
import MOD_HANDBOOK from "../../../../../docs/MOD-HANDBOOK.md?raw";
import PERMS_MATRIX from "../../../../../docs/PERMS-MATRIX.md?raw";
import GATEKEEPER_GUIDE from "../../../../../docs/GATEKEEPER-GUIDE.md?raw";
import MODERATOR_GUIDE from "../../../../../docs/MODERATOR-GUIDE.md?raw";
import ADMIN_GUIDE from "../../../../../docs/ADMIN-GUIDE.md?raw";
import LEADERSHIP_GUIDE from "../../../../../docs/LEADERSHIP-GUIDE.md?raw";
import MOD_QUICKREF from "../../../../../docs/MOD-QUICKREF.md?raw";
import TICKET_SYSTEM_GUIDE from "../../../../../docs/TICKET-SYSTEM-GUIDE.md?raw";
import SLASH_COMMANDS_REF from "../../../../../docs/reference/slash-commands.md?raw";

export type DocSlug =
  | "bot-handbook"
  | "mod-handbook"
  | "perms-matrix"
  | "gatekeeper-guide"
  | "moderator-guide"
  | "admin-guide"
  | "leadership-guide"
  | "mod-quickref"
  | "ticket-system"
  | "slash-commands";

export type DocMeta = {
  slug: DocSlug;
  title: string;
  defaultTier: HandbookTier;
  tagline: string;
  source: string;
};

export const DOC_REGISTRY: DocMeta[] = [
  {
    slug: "bot-handbook",
    title: "Bot Handbook",
    defaultTier: "public",
    tagline: "Every slash command, its options, who can run it, and how to use it.",
    source: BOT_HANDBOOK,
  },
  {
    slug: "mod-handbook",
    title: "Moderator Handbook",
    defaultTier: "gk",
    tagline: "Staff policies, verification procedures, escalation, cross-banning.",
    source: MOD_HANDBOOK,
  },
  {
    slug: "perms-matrix",
    title: "Permissions Matrix",
    defaultTier: "public",
    tagline: "Role hierarchy and which tier can run each command.",
    source: PERMS_MATRIX,
  },
  {
    slug: "gatekeeper-guide",
    title: "Gatekeeper Guide",
    defaultTier: "gk",
    tagline: "Onboarding for Gatekeepers: accept, reject, listopen workflow.",
    source: GATEKEEPER_GUIDE,
  },
  {
    slug: "moderator-guide",
    title: "Moderator Guide",
    defaultTier: "mod",
    tagline: "Day-to-day moderation tooling and policies.",
    source: MODERATOR_GUIDE,
  },
  {
    slug: "admin-guide",
    title: "Admin Guide",
    defaultTier: "admin",
    tagline: "Configuration, audit, cleanup, role recovery.",
    source: ADMIN_GUIDE,
  },
  {
    slug: "leadership-guide",
    title: "Leadership Guide",
    defaultTier: "cm",
    tagline: "Server-wide management: backfill, database recovery, migrations.",
    source: LEADERSHIP_GUIDE,
  },
  {
    slug: "mod-quickref",
    title: "Mod Quick Reference",
    defaultTier: "gk",
    tagline: "Cheat sheet for the most-used moderation commands.",
    source: MOD_QUICKREF,
  },
  {
    slug: "ticket-system",
    title: "Ticket System Guide",
    defaultTier: "gk",
    tagline: "First-party tickets: panel, close, manual reassign.",
    source: TICKET_SYSTEM_GUIDE,
  },
  {
    slug: "slash-commands",
    title: "Slash Commands (Quick)",
    defaultTier: "public",
    tagline: "Short index pointing into the Bot Handbook.",
    source: SLASH_COMMANDS_REF,
  },
];

const cache = new Map<DocSlug, Token[]>();

export function preloadAll(): void {
  for (const meta of DOC_REGISTRY) {
    if (!cache.has(meta.slug)) {
      cache.set(meta.slug, marked.lexer(meta.source, { gfm: true }));
    }
  }
}

export function getRawTokens(slug: DocSlug): Token[] {
  const cached = cache.get(slug);
  if (cached) return cached;
  const meta = DOC_REGISTRY.find((d) => d.slug === slug);
  if (!meta) throw new Error(`Unknown handbook slug: ${slug}`);
  const tokens = marked.lexer(meta.source, { gfm: true });
  cache.set(meta.slug, tokens);
  return tokens;
}

export function getDocMeta(slug: DocSlug): DocMeta | undefined {
  return DOC_REGISTRY.find((d) => d.slug === slug);
}
