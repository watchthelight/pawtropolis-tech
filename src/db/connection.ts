/**
 * Pawtropolis Tech Gatekeeper
 * Copyright (c) 2025 watchthelight (Bash) <admin@watchthelight.org>
 * License: MIT
 * Repo: https://github.com/watchthelight/pawtropolis-tech
 */

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

// Database configuration constants
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
// close database connection
function closeDatabase() {
  logger.info("Closing database connection...");
  try {
    db.close();
    logger.info("Database closed.");
  } catch (err) {
    logger.error({ err }, "Error closing database");
  }
}
process.on("SIGTERM", () => {
  closeDatabase();
  process.exit(0);
});
process.on("SIGINT", () => {
  closeDatabase();
  process.exit(0);
});