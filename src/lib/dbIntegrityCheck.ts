// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/lib/dbIntegrityCheck.ts
 * WHAT: Runs PRAGMA quick_check / integrity_check in a child process and keeps the last result.
 * WHY: Both pragmas walk every page of the file. On the production database that is seconds
 *      of blocked event loop when run on the bot's own connection, which is what the 60s
 *      ops health tick used to do. A child process pays the same disk cost without stalling
 *      Discord event handling, and its page cache goes away when it exits.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { env } from "./env.js";
import { logger } from "./logger.js";

export type DbIntegrityMode = "quick" | "full";

export interface DbIntegrityResult {
  ok: boolean;
  message: string;
  checkedAt: number;
  durationMs: number;
  mode: DbIntegrityMode;
}

const DB_DEFAULT_PATH = "data/data.db";
const CHECK_TIMEOUT_MS = parseInt(process.env.DB_INTEGRITY_TIMEOUT_MS ?? String(30 * 60_000), 10);

// Evaluated by `node -e`; argv after `--` is [dbPath, mode, driverPath].
const CHILD_SCRIPT = [
  "const [dbPath, mode, driverPath] = process.argv.slice(1);",
  "const Database = require(driverPath);",
  "const db = new Database(dbPath, { readonly: true, fileMustExist: true });",
  'const pragma = mode === "full" ? "PRAGMA integrity_check" : "PRAGMA quick_check";',
  "const rows = db.prepare(pragma).pluck().all();",
  "db.close();",
  "process.stdout.write(JSON.stringify(rows));",
].join("\n");

let last: DbIntegrityResult = {
  ok: true,
  message: "not yet checked",
  checkedAt: 0,
  durationMs: 0,
  mode: "quick",
};
let inFlight: Promise<DbIntegrityResult> | null = null;

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function dbFilePath(): string {
  return env.DB_PATH || DB_DEFAULT_PATH;
}

/** Result of the most recent check (a placeholder until the first one completes). */
export function getLastDbIntegrity(): DbIntegrityResult {
  return last;
}

export function runDbIntegrityCheck(
  mode: DbIntegrityMode = "quick",
  dbPath: string = dbFilePath()
): Promise<DbIntegrityResult> {
  const startedAt = Date.now();
  const finish = (ok: boolean, message: string): DbIntegrityResult => ({
    ok,
    message,
    checkedAt: Math.floor(Date.now() / 1000),
    durationMs: Date.now() - startedAt,
    mode,
  });

  if (!existsSync(dbPath)) {
    return Promise.resolve(finish(false, `database file not found: ${dbPath}`));
  }

  let driverPath: string;
  try {
    driverPath = createRequire(import.meta.url).resolve("better-sqlite3");
  } catch (err) {
    return Promise.resolve(finish(false, `cannot resolve better-sqlite3: ${errMsg(err)}`));
  }

  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["-e", CHILD_SCRIPT, "--", dbPath, mode, driverPath],
      { timeout: CHECK_TIMEOUT_MS, maxBuffer: 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err) {
          const killed = (err as { killed?: boolean }).killed === true;
          resolve(
            finish(false, killed ? `integrity check timed out after ${CHECK_TIMEOUT_MS}ms` : errMsg(err))
          );
          return;
        }
        try {
          const rows = JSON.parse(String(stdout || "[]")) as string[];
          const ok = rows.length === 1 && rows[0] === "ok";
          resolve(finish(ok, ok ? "ok" : rows.join("; ") || "no result"));
        } catch (parseErr) {
          resolve(finish(false, `unparseable integrity output: ${errMsg(parseErr)}`));
        }
      }
    );
  });
}

/** Single-flight refresh: concurrent callers share one child process. Never rejects. */
export function refreshDbIntegrity(mode: DbIntegrityMode = "quick"): Promise<DbIntegrityResult> {
  if (inFlight) return inFlight;
  inFlight = runDbIntegrityCheck(mode)
    .then((result) => {
      last = result;
      if (result.ok) {
        logger.info({ evt: "db_integrity_check", ...result }, "[dbIntegrity] check finished");
      } else {
        logger.error({ evt: "db_integrity_check", ...result }, "[dbIntegrity] check failed");
      }
      return result;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
