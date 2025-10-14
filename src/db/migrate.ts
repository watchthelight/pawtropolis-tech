/**
 * Pawtropolis Tech Gatekeeper
 * Copyright (c) 2025 watchthelight (Bash) <admin@watchthelight.org>
 * License: MIT
 * Repo: https://github.com/watchthelight/pawtropolis-tech
 */

import fs from "node:fs";
import path from "node:path";
import { db } from "./connection.js";
import { logger } from "../lib/logger.js";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");

function ensureMigrationsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function listMigrations(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

function alreadyApplied(filename: string): boolean {
  const row = db.prepare("SELECT 1 FROM schema_migrations WHERE filename = ?").get(filename);
  return !!row;
}

function applyMigration(filename: string) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), "utf8");
  // SQL files contain their own BEGIN/COMMIT, so just exec directly
  db.exec(sql);
  db.prepare("INSERT INTO schema_migrations(filename) VALUES (?)").run(filename);
  logger.info({ filename }, "Applied migration");
}

function main() {
  ensureMigrationsTable();
  for (const file of listMigrations()) {
    if (alreadyApplied(file)) {
      logger.debug({ file }, "Already applied, skipping");
      continue;
    }
    applyMigration(file);
  }
  logger.info("Migrations complete");
}

main();
