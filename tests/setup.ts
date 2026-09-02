/**
 * Pawtropolis Tech — tests/setup.ts
 * WHAT: Global Vitest setup for deterministic tests.
 * WHY: Disable schedulers, use fake timers, ensure cache always stale.
 *
 * This file runs before EVERY test file via the setupFiles config in vitest.config.ts.
 * Changes here affect all tests - be careful about side effects.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { beforeAll, afterEach, vi } from "vitest";

// Any test that reaches src/db/db.ts opens DB_PATH at import time and bootstraps tables on
// it. Without this it opened ./data/data.db, which locally is a copy of production. Each
// worker gets its own file under tests/.tmp seeded from the fixture schema. This runs at
// module level because setup files execute before the test file's own imports.
const TEST_DB_DIR = path.join("tests", ".tmp");
const TEST_DB_PATH = path.join(
  TEST_DB_DIR,
  `vitest-${process.pid}-${process.env.VITEST_POOL_ID ?? "0"}.db`
);
process.env.DB_PATH = TEST_DB_PATH.split(path.sep).join("/");
mkdirSync(TEST_DB_DIR, { recursive: true });
if (!existsSync(TEST_DB_PATH)) {
  const seed = new Database(TEST_DB_PATH);
  seed.pragma("busy_timeout = 5000");
  seed.pragma("journal_mode = WAL");
  seed.exec(readFileSync(path.join("tests", "fixtures", "schema.sql"), "utf8"));
  seed.close();
}
// Best-effort sweep of files left by earlier runs (open files fail to unlink and are skipped).
for (const name of readdirSync(TEST_DB_DIR)) {
  const full = path.join(TEST_DB_DIR, name);
  try {
    if (Date.now() - statSync(full).mtimeMs > 24 * 60 * 60 * 1000) unlinkSync(full);
  } catch {
    /* in use or already gone */
  }
}

beforeAll(() => {
  // The metrics scheduler runs background jobs on intervals. In tests, these
  // would fire unpredictably and cause flaky failures. Disabling entirely.
  process.env.METRICS_SCHEDULER_DISABLED = "1";

  // TTL=1ms means "always refetch" - prevents tests from accidentally passing
  // due to stale cached data from a previous test run. We want fresh data.
  // Note: LRUCache requires TTL > 0, so we use 1ms instead of 0.
  process.env.MOD_METRICS_TTL_MS = "1";
});

afterEach(() => {
  // Clean up any fake timers a test might have installed. If we don't do this,
  // a test using vi.useFakeTimers() would leak into subsequent tests.
  vi.clearAllTimers();
  // Restore real timers so the next test starts with a clean slate.
  // Without this, setTimeout/setInterval would remain mocked.
  vi.useRealTimers();
});
