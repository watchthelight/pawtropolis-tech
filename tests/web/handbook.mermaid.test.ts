// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/handbook.mermaid.test.ts
 * WHAT: REGRESSION coverage for handbook mermaid block detection.
 * WHY: A ```mermaid fence in the Mod Handbook (the "Decision Flow" diagram)
 *      rendered as literal source because MdNode routed every code token to
 *      CodeBlock. isMermaidBlock is the branch that now diverts mermaid
 *      fences to the diagram renderer; lock its behaviour so the flow chart
 *      cannot silently regress to raw text again.
 */

import { describe, expect, it } from "vitest";

import { isMermaidBlock } from "../../web/src/lib/shared/mermaid.js";

describe("isMermaidBlock", () => {
  it("REGRESSION: recognises a ```mermaid fence so it renders as a diagram", () => {
    expect(isMermaidBlock("mermaid")).toBe(true);
  });

  it("REGRESSION: matches case-insensitively and ignores trailing tokens", () => {
    expect(isMermaidBlock("Mermaid")).toBe(true);
    expect(isMermaidBlock("  mermaid  ")).toBe(true);
    expect(isMermaidBlock("mermaid theme=dark")).toBe(true);
  });

  it("leaves ordinary code fences on the CodeBlock path", () => {
    expect(isMermaidBlock("ts")).toBe(false);
    expect(isMermaidBlock("bash")).toBe(false);
    expect(isMermaidBlock("text")).toBe(false);
    expect(isMermaidBlock("")).toBe(false);
    expect(isMermaidBlock(undefined)).toBe(false);
    expect(isMermaidBlock(null)).toBe(false);
  });
});
