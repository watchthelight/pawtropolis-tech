// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/db/legacyGuard.test.ts
 * WHAT: Tests for the legacy SQL guard regex used in src/db/db.ts
 *       around the wrapped db.prepare() call.
 * WHY: The bot has historical schema renames that landed via
 *      ALTER TABLE ... RENAME and __old<...> tables. Re-introducing
 *      either pattern in a runtime SQL string would break recovery
 *      tooling. The guard catches such regressions at prepare-time.
 *
 * The regex itself lives inline in src/db/db.ts. We test the regex
 * directly here because the wrapped prepare requires a live DB to
 * exercise. If the regex is ever moved to a module, swap the import.
 */

import { describe, expect, it } from "vitest";

// Mirror of the regex in src/db/db.ts. Keep in sync if the source
// changes — the test asserts both regex patterns are still rejected.
const LEGACY_RE = /__old|ALTER\s+TABLE\s+.+\s+RENAME/i;

describe("legacy SQL guard regex", () => {
  it("rejects __old table references", () => {
    expect(LEGACY_RE.test("SELECT * FROM users__old")).toBe(true);
    expect(LEGACY_RE.test("SELECT * FROM users__old123")).toBe(true);
    expect(LEGACY_RE.test("INSERT INTO modmail__old VALUES (1)")).toBe(true);
  });

  it("rejects ALTER TABLE ... RENAME statements", () => {
    expect(
      LEGACY_RE.test("ALTER TABLE users RENAME TO users_new"),
    ).toBe(true);
    expect(
      LEGACY_RE.test("ALTER TABLE users RENAME COLUMN x TO y"),
    ).toBe(true);
    expect(
      LEGACY_RE.test("alter table users rename to users_v2"),
    ).toBe(true);
  });

  it("allows normal SELECT/INSERT/UPDATE/DELETE statements", () => {
    expect(LEGACY_RE.test("SELECT * FROM users")).toBe(false);
    expect(LEGACY_RE.test("INSERT INTO modmail VALUES (?)")).toBe(false);
    expect(LEGACY_RE.test("UPDATE application SET status='approved'")).toBe(false);
    expect(LEGACY_RE.test("DELETE FROM old_records WHERE id=?")).toBe(false);
  });

  it("allows CREATE TABLE without RENAME", () => {
    expect(
      LEGACY_RE.test("CREATE TABLE IF NOT EXISTS users (id TEXT)"),
    ).toBe(false);
  });

  it("allows ALTER TABLE that adds a column", () => {
    expect(
      LEGACY_RE.test("ALTER TABLE user_activity ADD COLUMN x INTEGER"),
    ).toBe(false);
  });

  it("allows column names that contain 'old' but not '__old'", () => {
    expect(LEGACY_RE.test("SELECT old_id FROM users")).toBe(false);
    expect(LEGACY_RE.test("SELECT * FROM users WHERE is_old = 1")).toBe(false);
  });

  it("rejects __old even inside a comment-like context", () => {
    // The guard is intentionally generous — it scans the raw SQL string.
    // A reference inside a string literal still fails. This is by
    // design: legacy SQL should not be in production prepare() calls
    // for any reason.
    expect(LEGACY_RE.test("SELECT 'users__old'")).toBe(true);
  });
});
