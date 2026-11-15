/**
 * Pawtropolis Tech -- web/src/lib/server/researchDb.ts
 * WHAT: Opens the score file of the research job, read-only.
 * WHY: The scores of the main chat live in a file of their own
 *      (data/research.db by default), so the bot's database stays small. The
 *      Quality page is its only reader here. The file is written by a job
 *      outside the dashboard, and a host that does not run the job has no
 *      such file, so a missing file is an answer and not an error.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import path from "node:path";

const botDbPath = process.env.DB_PATH || path.resolve(process.cwd(), "..", "data", "data.db");
// The job's own default: research.db next to the bot's database.
const scorePath = process.env.RESEARCH_DB_PATH || path.join(path.dirname(botDbPath), "research.db");

let connection: Database.Database | undefined;

/** The score file, or null as long as it does not exist. */
export function researchDb(): Database.Database | null {
  if (!connection) {
    if (!existsSync(scorePath)) return null;
    connection = new Database(scorePath, { readonly: true, fileMustExist: true });
    connection.pragma("busy_timeout = 5000");
  }
  return connection;
}
