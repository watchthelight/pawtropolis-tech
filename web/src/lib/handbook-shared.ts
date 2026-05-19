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
  | "owner"
  | "cm"
  | "cdl"
  | "sa"
  | "admin"
  | "sm"
  | "mod"
  | "jm"
  | "gk"
  | "viewer"
  | "none";

export type HandbookTier = DashboardTier | "public";

export const HANDBOOK_TIER_ORDER: HandbookTier[] = [
  "owner",
  "cm",
  "cdl",
  "sa",
  "admin",
  "sm",
  "mod",
  "jm",
  "gk",
  "viewer",
  "none",
  "public",
];

/**
 * Map of source filenames to canonical handbook slugs. Used to rewrite the
 * raw `.md` hrefs that live in cross-references inside docs/* into proper
 * `/handbook/<slug>` routes so they don't 404. Case-insensitive lookup.
 */
export const HANDBOOK_FILENAME_TO_SLUG: Record<string, string> = {
  "BOT-HANDBOOK.md": "bot-handbook",
  "MOD-HANDBOOK.md": "mod-handbook",
  "PERMS-MATRIX.md": "perms-matrix",
  "GATEKEEPER-GUIDE.md": "gatekeeper-guide",
  "MODERATOR-GUIDE.md": "moderator-guide",
  "ADMIN-GUIDE.md": "admin-guide",
  "LEADERSHIP-GUIDE.md": "leadership-guide",
  "MOD-QUICKREF.md": "mod-quickref",
  "TICKET-SYSTEM-GUIDE.md": "ticket-system",
  "slash-commands.md": "slash-commands",
};

/**
 * Rewrite a raw href as it appears in markdown source so that intra-handbook
 * cross-references end up at /handbook/<slug>. Anchors and absolute URLs are
 * preserved unchanged.
 */
export function rewriteHandbookHref(href: string | undefined | null): string {
  if (!href) return "";
  // Absolute URLs and protocol-relative — leave alone.
  if (/^(?:[a-z]+:)?\/\//i.test(href)) return href;
  // Anchor-only — leave alone (in-page jump).
  if (href.startsWith("#")) return href;

  const [pathPart, anchor] = href.split("#", 2);
  const filename = pathPart.split("/").filter(Boolean).pop() ?? "";
  const slug =
    HANDBOOK_FILENAME_TO_SLUG[filename] ??
    HANDBOOK_FILENAME_TO_SLUG[filename.toUpperCase()] ??
    HANDBOOK_FILENAME_TO_SLUG[filename.toLowerCase()];
  if (slug) {
    return anchor ? `/handbook/${slug}#${anchor}` : `/handbook/${slug}`;
  }
  return href;
}

export const HANDBOOK_TIER_LABELS: Record<HandbookTier, string> = {
  owner: "Owner / Dev",
  cm: "Community Manager",
  cdl: "Community Dev Lead",
  sa: "Senior Administrator",
  admin: "Administrator",
  sm: "Senior Moderator",
  mod: "Moderator",
  jm: "Junior Moderator",
  gk: "Gatekeeper",
  viewer: "Mod Team / Ambassador",
  none: "Signed in",
  public: "Everyone",
};
