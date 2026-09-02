/**
 * Pawtropolis Tech -- tests/docs/bot-handbook-commands.test.ts
 * WHAT: Every registered slash command is documented, and nothing documented is dead.
 * WHY: The handbook and the command reference drifted to 37 commands while 53 were
 *      registered (#00272). The runtime manifest is the single source of names.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SLASH_COMMAND_NAMES } from "../../src/commands/runtimeManifest.js";

const ROOT = path.resolve(__dirname, "../..");
const handbook = readFileSync(path.join(ROOT, "docs/BOT-HANDBOOK.md"), "utf8");
const reference = readFileSync(path.join(ROOT, "docs/reference/slash-commands.md"), "utf8");
const registered = new Set<string>(SLASH_COMMAND_NAMES);

/** Top-level command names from headings such as "### `/qotd suggest`". */
function handbookCommandHeadings(): string[] {
  const names: string[] = [];
  for (const m of handbook.matchAll(/^### `\/([a-z0-9-]+)(?: [a-z0-9-]+)*`/gm)) {
    names.push(m[1]!);
  }
  return names;
}

function quickReferenceTable(): string {
  const start = reference.indexOf("## Quick reference");
  const end = reference.indexOf("\n## ", start + 1);
  return reference.slice(start, end === -1 ? undefined : end);
}

describe("docs/BOT-HANDBOOK.md command headings", () => {
  const documented = new Set(handbookCommandHeadings());

  it("documents every registered slash command", () => {
    const missing = [...registered].filter((n) => !documented.has(n)).sort();
    expect(missing).toEqual([]);
  });

  it("only documents commands that are registered", () => {
    const stale = [...documented].filter((n) => !registered.has(n)).sort();
    expect(stale).toEqual([]);
  });
});

describe("docs/reference/slash-commands.md quick reference", () => {
  const table = quickReferenceTable();
  const listed = new Set([...table.matchAll(/`\/([a-z0-9-]+)`/g)].map((m) => m[1]!));

  it("lists every registered slash command", () => {
    const missing = [...registered].filter((n) => !listed.has(n)).sort();
    expect(missing).toEqual([]);
  });

  it("lists no command that is not registered", () => {
    const stale = [...listed].filter((n) => !registered.has(n)).sort();
    expect(stale).toEqual([]);
  });
});
