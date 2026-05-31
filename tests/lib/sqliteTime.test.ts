// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect } from "vitest";
import { parseSqliteUtc } from "../../src/lib/sqliteTime.js";

describe("parseSqliteUtc (#00114/#00116)", () => {
  it("parses a SQLite UTC string (no zone marker) as UTC, not local", () => {
    // 2026-05-31 14:00:00 UTC == 1748700000000ms
    const expected = Date.UTC(2026, 4, 31, 14, 0, 0);
    expect(parseSqliteUtc("2026-05-31 14:00:00")).toBe(expected);
  });

  it("does not shift by the host timezone offset", () => {
    // Equivalent to the explicit-UTC form regardless of host TZ.
    expect(parseSqliteUtc("2026-05-31 14:00:00")).toBe(Date.parse("2026-05-31T14:00:00Z"));
  });

  it("accepts already-ISO strings unchanged", () => {
    expect(parseSqliteUtc("2026-05-31T14:00:00Z")).toBe(Date.parse("2026-05-31T14:00:00Z"));
  });

  it("returns NaN for empty/nullish input", () => {
    expect(parseSqliteUtc(null)).toBeNaN();
    expect(parseSqliteUtc(undefined)).toBeNaN();
    expect(parseSqliteUtc("")).toBeNaN();
  });
});
