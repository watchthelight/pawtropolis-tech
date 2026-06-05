// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- web/src/lib/shared/mermaid.ts
 * WHAT: Decides whether a fenced code block is a mermaid diagram, so the
 *       handbook renderer can route it to the diagram renderer instead of
 *       dumping the source as literal text.
 * WHY: marked stores the info string in token.lang; a ```mermaid fence yields
 *      lang "mermaid" (sometimes with trailing words). Centralising the test
 *      keeps MdNode and the renderer in agreement and makes it unit-testable.
 */

export function isMermaidBlock(lang: string | undefined | null): boolean {
  if (!lang) return false;
  return lang.trim().split(/\s+/)[0].toLowerCase() === "mermaid";
}
