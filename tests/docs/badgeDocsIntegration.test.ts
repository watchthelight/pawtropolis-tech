// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * tests/docs/badgeDocsIntegration.test.ts
 * WHAT: Guard test that fails if any forward-facing Markdown doc reintroduces
 *       raw Discord mention syntax (<@&id>, <#id>, <@id>) outside a small
 *       allowlist of files that intentionally teach the syntax.
 * WHY: GitHub cannot render Discord mentions. We replaced raw mentions with
 *       generated SVG badges; this test prevents regressions.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// Files that may contain raw mentions on purpose (examples, dated audits).
const ALLOWLIST: string[] = [
  // Audit snapshots are dated artifacts; they intentionally show raw IDs.
  "docs-audit/discrepancy-matrix.md",
  "docs-audit/live-server-snapshot.md",
  // Implementation notes archive
  "docs/_archive/pr-implementation/PUBLIC-SITE-IMPLEMENTATION.md",
  // The badge documentation itself shows raw syntax to explain WHY badges exist.
  "docs/reference/github-discord-badges.md",
  "docs/reference/documentation-badge-style-guide.md",
  "docs/architecture/badge-system.md",
  "docs/operations/badge-refresh.md",
  // The plan describes the migration; it includes mention-syntax examples.
  "docs/roadmap/github-discord-badges-plan-2026-05-02.md",
];

// Directories excluded from the docs guard. These hold either dated audit
// snapshots, internal recon dumps, or archived docs that intentionally
// preserve historical IDs.
const EXCLUDE_DIRS = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".git",
  "_bmad",
  "_bmad-output",
  "_recon",
  "docs-audit",
  "data",
]);

const EXCLUDE_REL_PREFIXES = [
  "docs/_archive",
  "docs/audits",
  "docs/internal-info",
  "docs-audit",
  "_recon",
];

function listMarkdown(dir: string, root: string, acc: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    const rel = path.relative(root, full).replace(/\\/g, "/");
    if (ent.isDirectory()) {
      if (EXCLUDE_DIRS.has(ent.name)) continue;
      if (EXCLUDE_REL_PREFIXES.some((p) => rel === p || rel.startsWith(p + "/"))) continue;
      listMarkdown(full, root, acc);
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith(".md")) {
      if (EXCLUDE_REL_PREFIXES.some((p) => rel.startsWith(p + "/"))) continue;
      acc.push(full);
    }
  }
  return acc;
}

const RAW_MENTION_RE = /<(@&|#|@)\d{6,}>/g;

describe("docs do not contain raw Discord mention syntax", () => {
  const files = listMarkdown(REPO_ROOT, REPO_ROOT);
  const allowedAbs = new Set(
    ALLOWLIST.map((p) => path.resolve(REPO_ROOT, p)),
  );

  it("scans every checked-in markdown file", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file).replace(/\\/g, "/");
    if (allowedAbs.has(file)) continue;
    it(`no raw mentions in ${rel}`, () => {
      const text = fs.readFileSync(file, "utf8");
      const matches = text.match(RAW_MENTION_RE) ?? [];
      // Strip mentions inside fenced code blocks (intentional examples).
      const stripped = text.replace(/```[\s\S]*?```/g, "");
      const realMatches = stripped.match(RAW_MENTION_RE) ?? [];
      expect(
        realMatches,
        `Raw Discord mentions found in ${rel}: ${matches.join(", ")}. ` +
          "Replace them with generated badge image references " +
          "(see docs/reference/github-discord-badges.md), or add the file " +
          "to the docs guard allowlist.",
      ).toEqual([]);
    });
  }
});
