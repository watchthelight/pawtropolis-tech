// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/features/inventory/store.ts
 * WHAT: Database layer for the stackable reward inventory (migration 083).
 * WHY: A Discord role is binary, so a second copy of a reward role is silently lost.
 *      The ledger holds the real count and the role becomes a delivery vehicle.
 * FLOWS:
 *  - capture path: enqueueCapture -> dueCaptures -> creditItem
 *  - redeem path: debitItem -> role re-issued by the command
 *
 * No discord.js imports live here on purpose: everything below is directly testable
 * against an in-memory SQLite database.
 */

import { db } from "../../db/db.js";

export interface InventoryRow {
  item_key: string;
  quantity: number;
  updated_at_s: number;
}

export interface InventoryLogRow {
  item_key: string;
  delta: number;
  source: string;
  actor_id: string | null;
  reason: string | null;
  created_at_s: number;
}

export interface PendingCapture {
  id: number;
  guild_id: string;
  user_id: string;
  role_id: string;
  item_key: string;
  grant_key: string | null;
  detected_at_s: number;
  remove_at_s: number;
  attempts: number;
}

function writeLog(
  guildId: string,
  userId: string,
  itemKey: string,
  delta: number,
  source: string,
  actorId: string | null,
  reason: string | null
): void {
  db.prepare(`
    INSERT INTO inventory_log (guild_id, user_id, item_key, delta, source, actor_id, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(guildId, userId, itemKey, delta, source, actorId, reason);
}

/**
 * Add quantity to a user's stack and record the reason.
 * RETURNS: the stack size after the credit.
 */
export function creditItem(
  guildId: string,
  userId: string,
  itemKey: string,
  quantity: number,
  source: string,
  actorId: string | null = null,
  reason: string | null = null
): number {
  if (quantity <= 0) return getItemQuantity(guildId, userId, itemKey);

  db.prepare(`
    INSERT INTO inventory_items (guild_id, user_id, item_key, quantity, updated_at_s)
    VALUES (?, ?, ?, ?, unixepoch())
    ON CONFLICT(guild_id, user_id, item_key) DO UPDATE SET
      quantity = inventory_items.quantity + excluded.quantity,
      updated_at_s = excluded.updated_at_s
  `).run(guildId, userId, itemKey, quantity);

  writeLog(guildId, userId, itemKey, quantity, source, actorId, reason);
  return getItemQuantity(guildId, userId, itemKey);
}

/**
 * Spend from a user's stack.
 * The guard lives in the WHERE clause, so an empty stack fails atomically without a
 * read-then-write race between two concurrent redemptions.
 * RETURNS: true when the spend happened.
 */
export function debitItem(
  guildId: string,
  userId: string,
  itemKey: string,
  quantity: number,
  source: string,
  actorId: string | null = null,
  reason: string | null = null
): boolean {
  if (quantity <= 0) return false;

  const res = db.prepare(`
    UPDATE inventory_items
       SET quantity = quantity - ?, updated_at_s = unixepoch()
     WHERE guild_id = ? AND user_id = ? AND item_key = ? AND quantity >= ?
  `).run(quantity, guildId, userId, itemKey, quantity);

  if (res.changes === 0) return false;

  writeLog(guildId, userId, itemKey, -quantity, source, actorId, reason);
  return true;
}

export function getItemQuantity(guildId: string, userId: string, itemKey: string): number {
  const row = db.prepare(`
    SELECT quantity FROM inventory_items
     WHERE guild_id = ? AND user_id = ? AND item_key = ?
  `).get(guildId, userId, itemKey) as { quantity: number } | undefined;
  return row?.quantity ?? 0;
}

/** Every non-empty stack a user holds, richest first. */
export function getInventory(guildId: string, userId: string): InventoryRow[] {
  return db.prepare(`
    SELECT item_key, quantity, updated_at_s
      FROM inventory_items
     WHERE guild_id = ? AND user_id = ? AND quantity > 0
     ORDER BY quantity DESC, item_key ASC
  `).all(guildId, userId) as InventoryRow[];
}

export function getInventoryLog(guildId: string, userId: string, limit = 10): InventoryLogRow[] {
  return db.prepare(`
    SELECT item_key, delta, source, actor_id, reason, created_at_s
      FROM inventory_log
     WHERE guild_id = ? AND user_id = ?
     ORDER BY created_at_s DESC, id DESC
     LIMIT ?
  `).all(guildId, userId, limit) as InventoryLogRow[];
}

// ---------------------------------------------------------------------------
// Grace-window capture queue
// ---------------------------------------------------------------------------

/**
 * Queue a role for capture once its grace window expires.
 * The window exists so Mimu and Amari can finish their own post-grant verification
 * before the role disappears out from under them.
 *
 * UNIQUE(guild,user,role) means a burst of guildMemberUpdate events for the same role
 * collapses into one pending row rather than N captures.
 * RETURNS: true when a new capture was queued.
 */
export function enqueueCapture(
  guildId: string,
  userId: string,
  roleId: string,
  itemKey: string,
  removeAtS: number,
  grantKey: string | null = null
): boolean {
  const res = db.prepare(`
    INSERT OR IGNORE INTO pending_item_capture
      (guild_id, user_id, role_id, item_key, grant_key, remove_at_s)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(guildId, userId, roleId, itemKey, grantKey, removeAtS);
  return res.changes > 0;
}

export function dueCaptures(nowS: number, limit = 25): PendingCapture[] {
  return db.prepare(`
    SELECT * FROM pending_item_capture
     WHERE remove_at_s <= ?
     ORDER BY remove_at_s ASC
     LIMIT ?
  `).all(nowS, limit) as PendingCapture[];
}

export function deleteCapture(id: number): void {
  db.prepare(`DELETE FROM pending_item_capture WHERE id = ?`).run(id);
}

/**
 * Push a failed capture back by retryDelayS and count the attempt.
 * RETURNS: the new attempt count.
 */
export function deferCapture(id: number, retryDelayS: number): number {
  db.prepare(`
    UPDATE pending_item_capture
       SET attempts = attempts + 1, remove_at_s = unixepoch() + ?
     WHERE id = ?
  `).run(retryDelayS, id);
  const row = db.prepare(`SELECT attempts FROM pending_item_capture WHERE id = ?`)
    .get(id) as { attempts: number } | undefined;
  return row?.attempts ?? 0;
}

/**
 * Every capture still queued for a member, oldest first.
 * WHY: /stash reads the settled ledger, so an item inside its grace window looks like
 *      nothing was earned at all. The command needs the in-flight rows to say otherwise.
 */
export function pendingCapturesForUser(guildId: string, userId: string): PendingCapture[] {
  return db.prepare(`
    SELECT * FROM pending_item_capture
     WHERE guild_id = ? AND user_id = ?
     ORDER BY remove_at_s ASC
  `).all(guildId, userId) as PendingCapture[];
}

export function pendingCaptureFor(guildId: string, userId: string, roleId: string): PendingCapture | null {
  return (db.prepare(`
    SELECT * FROM pending_item_capture
     WHERE guild_id = ? AND user_id = ? AND role_id = ?
  `).get(guildId, userId, roleId) as PendingCapture) ?? null;
}

// ---------------------------------------------------------------------------
// Dedup
// ---------------------------------------------------------------------------

/**
 * Claim a one-shot grant key.
 * WHY: a reward bot that re-syncs its roles will re-add a role the inventory already
 *      took. Without a key, every re-sync silently inflates the stack. UNIQUE plus
 *      INSERT OR IGNORE makes the check-and-write atomic, the same trick
 *      levelRewards.ts uses against level_reward_granted.
 * RETURNS: true when the key was free, i.e. this grant counts.
 */
export function claimGrantKey(guildId: string, userId: string, grantKey: string): boolean {
  const res = db.prepare(`
    INSERT OR IGNORE INTO inventory_grant_keys (guild_id, user_id, grant_key)
    VALUES (?, ?, ?)
  `).run(guildId, userId, grantKey);
  return res.changes > 0;
}

/**
 * Whether this item was already credited to this user inside the debounce window.
 * WHY: covers repeatable items (Mimu purchases, byte tokens) where a one-shot key
 *      would be wrong but a reward-bot re-sync still must not count twice.
 */
export function creditedWithin(guildId: string, userId: string, itemKey: string, sinceS: number): boolean {
  const row = db.prepare(`
    SELECT 1 AS hit FROM inventory_log
     WHERE guild_id = ? AND user_id = ? AND item_key = ? AND delta > 0 AND created_at_s >= ?
     LIMIT 1
  `).get(guildId, userId, itemKey, sinceS) as { hit: number } | undefined;
  return row !== undefined;
}
