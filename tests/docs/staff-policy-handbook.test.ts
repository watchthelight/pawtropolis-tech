// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/docs/staff-policy-handbook.test.ts
 * WHAT: REGRESSION coverage for the 2026-10 staff policy update (#00278).
 * WHY: Leadership set application and ticket response deadlines plus profile and
 *      age-range review rules. The handbook is the only place staff read them, so
 *      lock them in against a future doc edit that drops them.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const read = (file: string) =>
  readFileSync(path.resolve(__dirname, "../../docs", file), "utf8");

const GATEKEEPER = read("GATEKEEPER-GUIDE.md");
const HANDBOOK = read("MOD-HANDBOOK.md");

function section(doc: string, heading: string): string {
  const start = doc.indexOf(`${heading}\n`);
  expect(start, `missing section: ${heading}`).toBeGreaterThan(-1);
  const level = heading.split(" ")[0];
  const rest = doc.slice(start + heading.length + 1);
  const end = rest.search(new RegExp(`\\n#{1,${level.length}} `));
  return end === -1 ? rest : rest.slice(0, end);
}

describe("Gatekeeper Guide review rules", () => {
  it("REGRESSION: keeps the Commands list", () => {
    const gate = section(GATEKEEPER, "### The Gate System");
    for (const cmd of ["/accept", "/reject", "/kick", "/unclaim", "/listopen", "/search"]) {
      expect(gate).toContain(cmd);
    }
  });

  it("REGRESSION: rejects age ranges unless fully 18+", () => {
    const ages = section(GATEKEEPER, "### Age Ranges Are Not Okay");
    expect(ages).toMatch(/16-18/);
    expect(ages).toMatch(/18 or over/);
    expect(ages).toMatch(/Discord ToS/);
  });

  it("REGRESSION: profile check covers status and Server Tag", () => {
    const profile = section(GATEKEEPER, "### Verify Their Profile");
    for (const part of ["Profile picture", "Banner", "Bio", "Status", "Server Tag"]) {
      expect(profile).toContain(part);
    }
    expect(profile).toMatch(/No AI-generated content/);
    expect(profile).toMatch(/No adult content/);
  });

  it("REGRESSION: applications are due within 6 hours", () => {
    expect(section(GATEKEEPER, "### Response Time")).toMatch(/within \*\*6 hours\*\*/);
  });
});

describe("Staff Handbook ticket and conduct rules", () => {
  it("REGRESSION: ticket response, close, and takeover windows", () => {
    const tickets = section(HANDBOOK, "### Rules for Handling Tickets");
    expect(tickets).toMatch(/within \*\*2 to 3 hours\*\* of being opened/);
    expect(tickets).toMatch(/within \*\*12 hours\*\* of it being resolved/);
    expect(tickets).toMatch(/within 6 hours of the request/);
  });

  it("REGRESSION: transparency lists member reporting of staff", () => {
    const t = section(HANDBOOK, "### Transparency");
    expect(t).toMatch(/Members can report team members/);
    expect(t).toMatch(/Monday newsletters/);
  });

  it("REGRESSION: attitude and demeanor are defined separately", () => {
    const ad = section(HANDBOOK, "### Attitude & Demeanor");
    expect(ad).toMatch(/\*\*Attitude\*\*/);
    expect(ad).toMatch(/\*\*Demeanor\*\*/);
  });
});
