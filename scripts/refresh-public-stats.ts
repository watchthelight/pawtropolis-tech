/**
 * Pawtropolis Tech -- scripts/refresh-public-stats.ts
 * WHAT: CLI wrapper that recomputes the public Stats Observatory rollups for
 *       the configured GUILD_ID. This is the "one-click update" entry point.
 * WHY: The /observatory page reads only precomputed rollups. Run this, then
 *       redeploy the web process:
 *         npm run stats:refresh && ./deploy.sh --web
 *       Or schedule it on EC2 (cron / scheduler) every ~15 minutes.
 * HOW: Opens its own writable connection (like scripts/migrate.ts) so it needs
 *       only DB_PATH + GUILD_ID, then delegates to refreshPublicStats.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import Database from "better-sqlite3";
import dotenv from "dotenv";
import { refreshPublicStats } from "../src/features/statsObservatory/refresh.js";

dotenv.config();

const dbPath = process.env.DB_PATH || "./data/data.db";
const guildId = process.env.GUILD_ID;

if (!guildId) {
  console.error("[stats:refresh] GUILD_ID environment variable is required.");
  process.exit(1);
}

const db = new Database(dbPath, { fileMustExist: true });
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 15000");

try {
  const startedAt = Date.now();
  const nowS = Math.floor(startedAt / 1000);
  const summary = refreshPublicStats(db, guildId, nowS);
  const elapsedMs = Date.now() - startedAt;
  console.log(`[stats:refresh] Observatory rollups rebuilt in ${elapsedMs}ms:`, summary);
} catch (err) {
  console.error("[stats:refresh] FAILED:", err);
  process.exit(1);
} finally {
  db.close();
}
