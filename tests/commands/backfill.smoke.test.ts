/**
 * Pawtropolis Tech — tests/commands/backfill.smoke.test.ts
 * WHAT: Regression guard for #00061 - /backfill spawned a non-existent script,
 *       so the command was permanently broken. This asserts the script the command
 *       spawns actually exists on disk.
 * WHY: A typo or rename of the backfill entrypoint silently breaks a staff command
 *       with no compile-time signal (the path is a string literal passed to spawn()).
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("/backfill spawn target", () => {
  it("spawns a script path that exists in the repo", () => {
    const src = readFileSync(resolve(repoRoot, "src/commands/backfill.ts"), "utf8");
    // Pull the script path out of the spawn(...) argument array, e.g.
    //   spawn('npx', ['tsx', 'scripts/backfill-message-activity.ts', ...args], ...)
    const match = src.match(/['"](scripts\/[^'"]+\.ts)['"]/);
    expect(match, "could not find a scripts/*.ts path in the spawn() call").not.toBeNull();
    const scriptPath = match![1];
    expect(existsSync(resolve(repoRoot, scriptPath)), `${scriptPath} does not exist`).toBe(true);
  });
});
