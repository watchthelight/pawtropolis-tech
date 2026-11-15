/**
 * Pawtropolis Tech -- tests/db/dbPathUnderMockedEnv.test.ts
 * WHAT: A test that mocks lib/env.js still gets the worker's throwaway database.
 * WHY: src/db/db.ts opens its file when it is imported. With env.DB_PATH missing
 *      it fell back to data/data.db, which on a dev machine is a copy of
 *      production, and the test run wrote to it.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// What a test does when it only cares about one or two settings.
vi.mock("../../src/lib/env.js", () => ({ env: {} }));

describe("database path under a mocked env", () => {
  it("opens the file tests/setup.ts prepared, not data/data.db", async () => {
    const { db } = await import("../../src/db/db.js");

    expect(process.env.DB_PATH).toMatch(/^tests\/\.tmp\/vitest-/);
    expect(path.normalize(db.name)).toBe(path.normalize(process.env.DB_PATH ?? ""));
  });

  it("names the same file for the integrity check", async () => {
    const { dbFilePath } = await import("../../src/lib/dbIntegrityCheck.js");

    expect(dbFilePath()).toBe(process.env.DB_PATH);
  });
});
