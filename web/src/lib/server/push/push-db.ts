/**
 * Writable SQLite database for push subscriptions.
 * Separate from the main data.db (which is read-only in the web process).
 * Auto-creates the schema on first access.
 */

import Database from "better-sqlite3";
import path from "node:path";
import type { DashboardTier } from "$lib/server/roles";

const DB_BUSY_TIMEOUT_MS = 5000;

const dbPath =
  process.env.PUSH_DB_PATH ||
  path.resolve(path.dirname(process.env.DB_PATH || path.join("data", "data.db")), "push.db");

let _db: Database.Database | undefined;

function db(): Database.Database {
  if (!_db) {
    _db = new Database(dbPath);
    _db.pragma("journal_mode = WAL");
    _db.pragma("synchronous = NORMAL");
    _db.pragma("foreign_keys = ON");
    _db.pragma(`busy_timeout = ${DB_BUSY_TIMEOUT_MS}`);

    // Auto-create schema
    _db.exec(`
			CREATE TABLE IF NOT EXISTS push_subscriptions (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id TEXT NOT NULL,
				tier TEXT NOT NULL DEFAULT 'gk',
				endpoint TEXT NOT NULL UNIQUE,
				keys_p256dh TEXT NOT NULL,
				keys_auth TEXT NOT NULL,
				pref_review INTEGER NOT NULL DEFAULT 1,
				pref_modmail INTEGER NOT NULL DEFAULT 1,
				pref_flag INTEGER NOT NULL DEFAULT 1,
				pref_audit INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL DEFAULT (unixepoch()),
				last_used_at INTEGER
			);
			CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
		`);
  }
  return _db;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PushSubscriptionRow {
  id: number;
  user_id: string;
  tier: DashboardTier;
  endpoint: string;
  keys_p256dh: string;
  keys_auth: string;
  pref_review: number;
  pref_modmail: number;
  pref_flag: number;
  pref_audit: number;
  created_at: number;
  last_used_at: number | null;
}

export interface PushPreferences {
  review?: boolean;
  modmail?: boolean;
  flag?: boolean;
  audit?: boolean;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function upsertSubscription(
  userId: string,
  tier: DashboardTier,
  endpoint: string,
  p256dh: string,
  auth: string,
  prefs?: PushPreferences
): void {
  db()
    .prepare(
      `
		INSERT INTO push_subscriptions (user_id, tier, endpoint, keys_p256dh, keys_auth, pref_review, pref_modmail, pref_flag, pref_audit)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(endpoint) DO UPDATE SET
			user_id = excluded.user_id,
			tier = excluded.tier,
			keys_p256dh = excluded.keys_p256dh,
			keys_auth = excluded.keys_auth,
			pref_review = excluded.pref_review,
			pref_modmail = excluded.pref_modmail,
			pref_flag = excluded.pref_flag,
			pref_audit = excluded.pref_audit
	`
    )
    .run(
      userId,
      tier,
      endpoint,
      p256dh,
      auth,
      prefs?.review !== false ? 1 : 0,
      prefs?.modmail !== false ? 1 : 0,
      prefs?.flag !== false ? 1 : 0,
      (prefs?.audit ?? false) ? 1 : 0
    );
}

export function removeSubscription(endpoint: string): void {
  db().prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
}

export function removeAllSubscriptions(userId: string): void {
  db().prepare("DELETE FROM push_subscriptions WHERE user_id = ?").run(userId);
}

export function getSubscriptionsForUser(userId: string): PushSubscriptionRow[] {
  return db()
    .prepare("SELECT * FROM push_subscriptions WHERE user_id = ?")
    .all(userId) as PushSubscriptionRow[];
}

/** Get subscriptions that have a specific preference domain enabled. */
export function getSubscriptionsForDomain(domain: string): PushSubscriptionRow[] {
  const col = `pref_${domain}`;
  const allowed = ["pref_review", "pref_modmail", "pref_flag", "pref_audit"];
  if (!allowed.includes(col)) return [];
  return db()
    .prepare(`SELECT * FROM push_subscriptions WHERE ${col} = 1`)
    .all() as PushSubscriptionRow[];
}

export function updateLastUsed(endpoint: string): void {
  db()
    .prepare("UPDATE push_subscriptions SET last_used_at = unixepoch() WHERE endpoint = ?")
    .run(endpoint);
}

export function updateTier(userId: string, tier: DashboardTier): void {
  db().prepare("UPDATE push_subscriptions SET tier = ? WHERE user_id = ?").run(tier, userId);
}

export function updatePreferences(endpoint: string, prefs: PushPreferences): void {
  const sets: string[] = [];
  const vals: (number | string)[] = [];
  if (prefs.review !== undefined) {
    sets.push("pref_review = ?");
    vals.push(prefs.review ? 1 : 0);
  }
  if (prefs.modmail !== undefined) {
    sets.push("pref_modmail = ?");
    vals.push(prefs.modmail ? 1 : 0);
  }
  if (prefs.flag !== undefined) {
    sets.push("pref_flag = ?");
    vals.push(prefs.flag ? 1 : 0);
  }
  if (prefs.audit !== undefined) {
    sets.push("pref_audit = ?");
    vals.push(prefs.audit ? 1 : 0);
  }
  if (sets.length === 0) return;
  vals.push(endpoint);
  db()
    .prepare(`UPDATE push_subscriptions SET ${sets.join(", ")} WHERE endpoint = ?`)
    .run(...vals);
}

/** Delete subscriptions not used in the last 30 days. */
export function deleteStaleSubscriptions(): number {
  const cutoff = Math.floor(Date.now() / 1000) - 30 * 86400;
  const result = db()
    .prepare("DELETE FROM push_subscriptions WHERE last_used_at IS NOT NULL AND last_used_at < ?")
    .run(cutoff);
  return result.changes;
}
