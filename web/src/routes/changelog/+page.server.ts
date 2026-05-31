/**
 * Pawtropolis Tech - web/src/routes/changelog/+page.server.ts
 * WHAT: Renders the repo CHANGELOG.md as a themed page at /changelog.
 * WHY: /CHANGELOG.md 404'd because the file lives at the repo root, outside the
 *      web app's served paths. Inlining it via Vite's `?raw` at build time (the
 *      same trick the handbook uses for docs/) keeps the page current with the
 *      committed changelog and needs no runtime filesystem access on EC2.
 */
import { marked } from "marked";
import type { PageServerLoad } from "./$types";
import CHANGELOG_RAW from "../../../../CHANGELOG.md?raw";

// SSR on demand rather than prerender: the changelog's own "Versions:" nav links
// to a few historical anchors that have no heading section, which the prerender
// anchor validator rejects. The content is inlined at build time and cached in
// the module, so server rendering is a string lookup.
export const prerender = false;

// GitHub-style heading slug so the in-document "Versions:" anchor links resolve
// (e.g. "[6.0.0] - 2026-05-15" -> "600---2026-05-15").
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/ +/g, "-");
}

let cached: string | null = null;

export const load: PageServerLoad = async () => {
  if (cached === null) {
    const raw = await marked.parse(CHANGELOG_RAW, { gfm: true });
    // marked no longer emits heading ids; add them so anchor nav works.
    cached = raw.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_m, depth, inner) => {
      const text = inner.replace(/<[^>]+>/g, "");
      return `<h${depth} id="${slugify(text)}">${inner}</h${depth}>`;
    });
  }
  return { html: cached };
};
