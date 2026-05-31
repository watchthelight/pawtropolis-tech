/**
 * Pawtropolis Tech — src/features/voiceSessionTracker.ts
 * WHAT: Tracks all voice channel sessions (join/leave/move) in the voice_session table
 * WHY: Powers newsletter voice minutes + pulse insights engine voice trend detection
 * FLOWS:
 *  - voiceStateUpdate → handleVoiceStateUpdate() → insert join / close leave
 *  - ready → seedCurrentVoiceSessions() → snapshot all currently-connected users
 *  - shutdown → closeAllOpenSessions() → close all open sessions before exit
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import type { Client, VoiceState } from "discord.js";

// ─── Prepared Statements (lazy-init to avoid DB access at import time) ────────

let _insertJoin: ReturnType<typeof db.prepare> | null = null;
let _lastJoinedAt: ReturnType<typeof db.prepare> | null = null;
let _closeSession: ReturnType<typeof db.prepare> | null = null;
let _closeAllUser: ReturnType<typeof db.prepare> | null = null;
let _closeAll: ReturnType<typeof db.prepare> | null = null;

function insertJoinStmt() {
  // Plain INSERT (not OR IGNORE): insertVoiceJoin bumps joined_at_s past any
  // existing row for the key, so a same-second rejoin can never collide on the
  // UNIQUE constraint. OR IGNORE used to silently drop such an open session and
  // lose the voice time. #00166
  return (_insertJoin ??= db.prepare(
    `INSERT INTO voice_session (guild_id, user_id, channel_id, joined_at_s)
     VALUES (?, ?, ?, ?)`
  ));
}

function lastJoinedAtStmt() {
  return (_lastJoinedAt ??= db.prepare(
    `SELECT MAX(joined_at_s) AS m FROM voice_session
     WHERE guild_id = ? AND user_id = ? AND channel_id = ?`
  ));
}

function closeSessionStmt() {
  // SQLite doesn't support ORDER BY + LIMIT in UPDATE, so use a subquery
  return (_closeSession ??= db.prepare(
    `UPDATE voice_session SET left_at_s = ?
     WHERE rowid = (
       SELECT rowid FROM voice_session
       WHERE guild_id = ? AND user_id = ? AND channel_id = ? AND left_at_s IS NULL
       ORDER BY joined_at_s DESC LIMIT 1
     )`
  ));
}

function closeAllUserStmt() {
  return (_closeAllUser ??= db.prepare(
    `UPDATE voice_session SET left_at_s = ?
     WHERE guild_id = ? AND user_id = ? AND left_at_s IS NULL`
  ));
}

function closeAllStmt() {
  return (_closeAll ??= db.prepare(
    `UPDATE voice_session SET left_at_s = ? WHERE left_at_s IS NULL`
  ));
}

// ─── Core Operations ─────────────────────────────────────────────────────────

function insertVoiceJoin(guildId: string, userId: string, channelId: string): void {
  const nowS = Math.floor(Date.now() / 1000);
  // Guard against a same-second rejoin colliding with a just-closed row on the
  // UNIQUE(guild_id, user_id, channel_id, joined_at_s) constraint: bump the new
  // join's timestamp past any existing row for this key so the open session is
  // always recorded. The drift is at most a few seconds and self-corrects once
  // wall-clock time advances. #00166
  const last = lastJoinedAtStmt().get(guildId, userId, channelId) as
    | { m: number | null }
    | undefined;
  const joinedAtS = last?.m != null ? Math.max(nowS, last.m + 1) : nowS;
  insertJoinStmt().run(guildId, userId, channelId, joinedAtS);
}

function closeVoiceSession(guildId: string, userId: string, channelId: string): void {
  closeSessionStmt().run(Math.floor(Date.now() / 1000), guildId, userId, channelId);
}

// ─── Event Handler ───────────────────────────────────────────────────────────

export function handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): void {
  const guildId = newState.guild?.id;
  if (!guildId) return;

  const userId = newState.member?.id ?? newState.id;
  if (!userId) return;

  const oldChannel = oldState.channelId;
  const newChannel = newState.channelId;

  // Case 1: Joined a voice channel (wasn't in one before)
  if (!oldChannel && newChannel) {
    insertVoiceJoin(guildId, userId, newChannel);
    return;
  }

  // Case 2: Left a voice channel (was in one, now isn't)
  if (oldChannel && !newChannel) {
    closeVoiceSession(guildId, userId, oldChannel);
    return;
  }

  // Case 3: Moved between channels
  if (oldChannel && newChannel && oldChannel !== newChannel) {
    closeVoiceSession(guildId, userId, oldChannel);
    insertVoiceJoin(guildId, userId, newChannel);
    return;
  }

  // Case 4: Same channel, state changed (mute/deafen/etc) — no-op
}

// ─── Startup: Seed Sessions for Currently-Connected Users ────────────────────

export function seedCurrentVoiceSessions(client: Client): void {
  const nowS = Math.floor(Date.now() / 1000);
  let seeded = 0;

  for (const [, guild] of client.guilds.cache) {
    for (const [, state] of guild.voiceStates.cache) {
      if (state.channelId && state.member) {
        // Close any stale open sessions for this user first
        closeAllUserStmt().run(nowS, guild.id, state.member.id);
        // Open a fresh session
        insertVoiceJoin(guild.id, state.member.id, state.channelId);
        seeded++;
      }
    }
  }

  if (seeded > 0) {
    logger.info({ seeded }, "[voice-tracker] Seeded sessions for users currently in voice");
  }
}

// ─── Shutdown: Close All Open Sessions ───────────────────────────────────────

export function closeAllOpenSessions(): void {
  const result = closeAllStmt().run(Math.floor(Date.now() / 1000));
  if (result.changes > 0) {
    logger.info({ closed: result.changes }, "[voice-tracker] Closed open voice sessions on shutdown");
  }
}
