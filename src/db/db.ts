// SPDX-License-Identifier: LicenseRef-ANW-1.0
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

const DB_BUSY_TIMEOUT_MS = 5000;
const DB_DEFAULT_PATH = "data/data.db";

const dbPath = env.DB_PATH || DB_DEFAULT_PATH;
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
export const db = new Database(dbPath, { fileMustExist: false });
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");
db.pragma(`busy_timeout = ${DB_BUSY_TIMEOUT_MS}`);
logger.info({ dbPath }, "SQLite opened");

async function closeDatabase() {
  logger.info("Closing database connection...");
  try {
    db.close();
    logger.info("Database closed successfully");
  } catch (err) {
    logger.error({ err }, "Error closing database");
  }

  try {
    const { flushSentry } = await import("../lib/sentry.js");
    await flushSentry();
    logger.info("Sentry events flushed");
  } catch (err) {
    logger.warn({ err }, "Failed to flush Sentry events");
  }
}

process.on("SIGTERM", () => {
  closeDatabase().finally(() => process.exit(0));
});

process.on("SIGINT", () => {
  closeDatabase().finally(() => process.exit(0));
});
