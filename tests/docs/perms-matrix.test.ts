/**
 * Pawtropolis Tech -- tests/docs/perms-matrix.test.ts
 * WHAT: docs/PERMS-MATRIX.md agrees with src/lib/roles.ts and the registered commands.
 * WHY: The matrix is what staff read to learn who can run what; a stale role id or a
 *      missing command there is a support ticket waiting to happen (#00272).
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SLASH_COMMAND_NAMES } from "../../src/commands/runtimeManifest.js";
import { BOT_OWNER_UID, ROLE_HIERARCHY, ROLE_IDS } from "../../src/lib/roles.js";

const ROOT = path.resolve(__dirname, "../..");
const matrix = readFileSync(path.join(ROOT, "docs/PERMS-MATRIX.md"), "utf8");

function section(title: string): string {
  const start = matrix.indexOf(`\n## ${title}`);
  expect(start, `section "${title}"`).toBeGreaterThan(-1);
  const end = matrix.indexOf("\n## ", start + 1);
  return matrix.slice(start, end === -1 ? undefined : end);
}

const commandsBody = matrix.slice(matrix.indexOf("\n## Commands by Permission Level"));

describe("role hierarchy table", () => {
  it("lists the same ids in the same order as ROLE_HIERARCHY", () => {
    const rows = [...section("Role Hierarchy").matchAll(/^\| (\d+) \| .*?\| `(\d{17,20})` \|/gm)];
    expect(rows.map((r) => r[2])).toEqual([...ROLE_HIERARCHY]);
  });

  it("names the bypass role and the bot owner", () => {
    const bypass = section("Special Bypass Roles");
    expect(bypass).toContain(`\`${ROLE_IDS.SERVER_DEV}\``);
    expect(bypass).toContain(`\`${BOT_OWNER_UID}\``);
  });
});

describe("command coverage", () => {
  const listed = new Set([...commandsBody.matchAll(/`\/([a-z0-9-]+)[` ]/g)].map((m) => m[1]!));

  it("mentions every registered slash command", () => {
    const missing = SLASH_COMMAND_NAMES.filter((n) => !listed.has(n)).sort();
    expect(missing).toEqual([]);
  });

  it("mentions no command that is not registered", () => {
    const registered = new Set<string>(SLASH_COMMAND_NAMES);
    const stale = [...listed].filter((n) => !registered.has(n)).sort();
    expect(stale).toEqual([]);
  });
});

describe("hierarchy tiers of commands with a single requireMinRole", () => {
  // Expected values come from the requireMinRole call at the top of each command's
  // execute path. Change the code, change this table, change the matrix.
  const expected: Array<[command: string, sectionPrefix: string]> = [
    ["flag", "Junior Moderator+"], // src/commands/flag.ts
    ["isitreal", "Junior Moderator+"], // src/commands/isitreal.ts
    ["movie", "Moderator+"], // src/commands/movie.ts
    ["skullmode", "Senior Moderator+"], // src/commands/skullmode.ts
    ["update", "Senior Moderator+"], // src/commands/update.ts (activity/status; banner/avatar are CM+)
    ["panic", "Senior Administrator+"], // src/commands/panic.ts
    ["backfill", "Community Manager+"], // src/commands/backfill.ts
  ];

  function firstSectionMentioning(command: string): string {
    const parts = commandsBody.split(/^### /gm).slice(1);
    const hit = parts.find((p) => new RegExp(`\`/${command}[\` ]`).test(p));
    return hit ? hit.split("\n")[0]!.trim() : "(not listed)";
  }

  it.each(expected)("/%s is first listed under %s", (command, prefix) => {
    expect(firstSectionMentioning(command).startsWith(prefix)).toBe(true);
  });
});
