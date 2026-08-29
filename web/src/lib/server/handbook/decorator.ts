/**
 * Pawtropolis Tech — web/src/lib/server/handbook/decorator.ts
 * WHAT: Walks a marked token tree, folds command-section patterns into
 *       synthetic `command_section` tokens, and attaches `requiredTier` +
 *       `canRun` to every section so the renderer can dim locked content.
 * WHY: The renderer must stay a pure mapper from token-type to Svelte
 *      component. All permission reasoning happens here, server-side, where
 *      it can be unit-tested cheaply.
 */

import type { Token, Tokens } from "marked";
import {
  meetsTier,
  parsePermissionLine,
  stripWhoCanUseItPrefix,
  type HandbookTier,
  type PermissionRequirement,
} from "./permissionResolver";
import type { DocMeta } from "./loader";
import { isWithinNewWindow, parseNewMarker } from "../../handbook-shared";

/**
 * A "command_section" wraps the heading that introduces a slash command and
 * every token that belongs to it (up to the next heading at the same depth).
 * `requiredTier` defaults to the doc's `defaultTier` and is overridden when a
 * "Who can use it:" line is present.
 */
export type CommandSectionToken = {
  type: "command_section";
  headingDepth: number;
  commandName: string;
  headingText: string;
  headingSlug: string;
  requiredTier: HandbookTier;
  permission: PermissionRequirement | null;
  canRun: boolean;
  lockedForLoggedOut: boolean;
  /** Date from the section's `<!-- new: YYYY-MM-DD -->` marker, if it has one. */
  newSince: string | null;
  /** Whether that date is still inside the highlight window, evaluated per request. */
  isNew: boolean;
  body: DecoratedToken[];
};

/**
 * Same as a command_section but for plain headings — used for narrative
 * sections inside MOD-HANDBOOK / role guides that should also display a
 * tier badge.
 */
export type SectionToken = {
  type: "section";
  headingDepth: number;
  headingText: string;
  headingSlug: string;
  requiredTier: HandbookTier;
  canRun: boolean;
  lockedForLoggedOut: boolean;
  newSince: string | null;
  isNew: boolean;
  body: DecoratedToken[];
};

export type DecoratedToken = Token | CommandSectionToken | SectionToken;

export type DecoratedDoc = {
  tokens: DecoratedToken[];
  tocEntries: Array<{
    depth: number;
    slug: string;
    text: string;
    tier: HandbookTier;
    newSince: string | null;
  }>;
};

/**
 * Top-level entrypoint. Builds the decorated tree for one doc.
 *  - `meta` provides the doc's `defaultTier`.
 *  - `viewerTier` is the requesting user's tier; computed `canRun` is just a
 *    cached convenience for the renderer.
 *  - `isLoggedOut` toggles the "show only public stuff" branch.
 */
export function decorate(
  tokens: Token[],
  meta: DocMeta,
  viewerTier: HandbookTier,
  isLoggedOut: boolean
): DecoratedDoc {
  const out: DecoratedToken[] = [];
  const tocEntries: DecoratedDoc["tocEntries"] = [];

  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];

    // Pass through non-heading content at the top level.
    if (t.type !== "heading") {
      out.push(t);
      i++;
      continue;
    }

    const heading = t as Tokens.Heading;
    const headingText = heading.text.trim();
    const slug = slugify(headingText);
    // Strip backticks (`/foo`) so headings written as inline code still match.
    const headingPlain = headingText.replace(/`/g, "").trim();
    const commandMatch = headingPlain.match(/^\/([a-z][\w-]*)$/i);

    // Collect body tokens *up to the next heading at any depth*. The handbook is
    // rendered flat: every heading starts a new top-level section. Sub-headings
    // inside a section's body cannot exist in this flattened model; if the source
    // nests h4+ under an h3, we still pick up the next h2/h3 boundary and stop.
    const body: Token[] = [];
    let j = i + 1;
    while (j < tokens.length) {
      const next = tokens[j];
      if (next.type === "heading") break;
      body.push(next);
      j++;
    }

    // Try to find a "Who can use it:" line in the first paragraph of the body.
    const permission = findPermissionInBody(body);
    const newSince = findNewMarkerInBody(body);
    const isNew = isWithinNewWindow(newSince);
    const requiredTier = permission?.tier ?? meta.defaultTier;
    const canRun = meetsTier(viewerTier, requiredTier);
    const lockedForLoggedOut = isLoggedOut && requiredTier !== "public";

    if (commandMatch) {
      const commandName = commandMatch[1].toLowerCase();
      out.push({
        type: "command_section",
        headingDepth: heading.depth,
        commandName,
        headingText,
        headingSlug: slug,
        requiredTier,
        permission,
        canRun,
        lockedForLoggedOut,
        newSince,
        isNew,
        body: body as DecoratedToken[],
      } satisfies CommandSectionToken);
    } else if (heading.depth <= 3) {
      out.push({
        type: "section",
        headingDepth: heading.depth,
        headingText,
        headingSlug: slug,
        requiredTier,
        canRun,
        lockedForLoggedOut,
        newSince,
        isNew,
        body: body as DecoratedToken[],
      } satisfies SectionToken);
    } else {
      // Deep sub-heading (h4+) — push as a plain decorated heading with a slug
      // so the body can render it inline, then dump its body tokens after.
      out.push({ ...heading, headingSlug: slug } as Token);
      for (const b of body) out.push(b);
    }

    tocEntries.push({
      depth: heading.depth,
      slug,
      text: headingPlain || headingText,
      tier: requiredTier,
      newSince,
    });

    i = j;
  }

  return { tokens: out, tocEntries };
}

/**
 * Look for a `<!-- new: YYYY-MM-DD -->` marker in a section body.
 * `marked` emits html comments as `html` tokens and the renderer already skips those, so
 * the marker never appears on the page. Only the run of tokens before the first block of
 * real content is searched, so a comment buried further down cannot flag a section.
 */
function findNewMarkerInBody(body: Token[]): string | null {
  for (const t of body) {
    if (t.type === "space") continue;
    if (t.type !== "html") break;
    const since = parseNewMarker((t as Tokens.HTML).raw ?? "");
    if (since) return since;
  }
  return null;
}

function findPermissionInBody(body: Token[]): PermissionRequirement | null {
  for (const t of body) {
    if (t.type !== "paragraph") continue;
    const para = t as Tokens.Paragraph;
    // `marked` preserves the raw markdown of each token, asterisks intact.
    const stripped = stripWhoCanUseItPrefix(para.raw ?? para.text ?? "");
    if (stripped) {
      return parsePermissionLine(stripped);
    }
  }
  return null;
}

const slugCounts = new Map<string, number>();

/**
 * GitHub-flavoured slug for in-page anchors. Uniqueness is enforced within a
 * single doc by appending `-1`, `-2`, ... when a slug repeats.
 */
export function slugify(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\w\s/-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  const slug = base.length ? base : "section";
  const count = slugCounts.get(slug) ?? 0;
  slugCounts.set(slug, count + 1);
  return count === 0 ? slug : `${slug}-${count}`;
}

/** Reset the per-doc slug counter so decorate() can be called safely in a loop. */
export function resetSlugCounter(): void {
  slugCounts.clear();
}
