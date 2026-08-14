// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/docs/mod-handbook-roles.test.ts
 * WHAT: REGRESSION coverage for the Junior Moderator tool scope in MOD-HANDBOOK.md.
 * WHY: The handbook used to fold Moderators and Junior Moderators into one section
 *      that listed "warn, mute, kick, ban" for both ranks. Junior Moderators do not
 *      have kick or ban in the live server, so staff were reading a permission they
 *      could not use. Lock the split so a future doc edit cannot re-merge them.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const HANDBOOK = readFileSync(
  path.resolve(__dirname, "../../docs/MOD-HANDBOOK.md"),
  "utf8",
);

function section(heading: string): string {
  const start = HANDBOOK.indexOf(`### ${heading}\n`);
  expect(start, `missing section: ${heading}`).toBeGreaterThan(-1);
  const rest = HANDBOOK.slice(start + heading.length + 5);
  const end = rest.indexOf("\n### ");
  return end === -1 ? rest : rest.slice(0, end);
}

describe("MOD-HANDBOOK role responsibilities", () => {
  it("REGRESSION: does not fold Junior Moderators into the Moderator section", () => {
    expect(HANDBOOK).not.toContain("### Moderator(s) / Junior Moderator(s)");
    expect(HANDBOOK).toContain("### Junior Moderator(s)");
  });

  it("REGRESSION: states Junior Moderators cannot kick or ban", () => {
    const jm = section("Junior Moderator(s)");
    expect(jm).toMatch(/cannot kick or ban/i);
    expect(jm).toMatch(/full Moderator or above/i);
  });

  it("REGRESSION: keeps warn and mute plus the warn threshold for Junior Moderators", () => {
    const jm = section("Junior Moderator(s)");
    expect(jm).toMatch(/warn and mute/i);
    expect(jm).toMatch(/warn threshold/i);
  });

  it("keeps the full tool set on the Moderator section", () => {
    const mod = section("Moderator(s)");
    expect(mod).toMatch(/warn, mute, kick, ban/);
  });

  it("gates the kick and ban walkthrough on Moderator rank", () => {
    const idx = HANDBOOK.indexOf("#### Kicking/Banning");
    expect(idx).toBeGreaterThan(-1);
    expect(HANDBOOK.slice(idx, idx + 400)).toMatch(
      /Rank requirement:\*\* Moderator or above/,
    );
  });
});
