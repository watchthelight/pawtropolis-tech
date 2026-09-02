// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech — src/features/welcomeBatch.ts
 * WHAT: In-memory session manager for batched welcome cards.
 * WHY: Lets a Gatekeeper open a session, accept multiple users, then send one combined
 *      welcome card with /welcomebatch send. Auto-expires after 30 min idle.
 * NOTE: State is process-local. Bot restart drops any open session and discards buffer.
 */
import type { Guild, GuildMember } from "discord.js";
import { logger } from "../lib/logger.js";
import type { GuildConfig } from "../lib/config.js";
import { postBatchWelcomeCard, postWelcomeCard } from "./welcome.js";

export const WELCOME_BATCH_EXPIRY_MS = 30 * 60 * 1000;
export const WELCOME_BATCH_MAX_USERS = 25;

type Session = {
  guildId: string;
  members: GuildMember[];
  openedBy: string;
  openedAt: number;
  expiryTimer: NodeJS.Timeout;
};

const sessions = new Map<string, Session>();

export function getSessionStatus(guildId: string): {
  active: boolean;
  openedBy?: string;
  openedAt?: number;
  memberIds?: string[];
} {
  const s = sessions.get(guildId);
  if (!s) return { active: false };
  return {
    active: true,
    openedBy: s.openedBy,
    openedAt: s.openedAt,
    memberIds: s.members.map((m) => m.id),
  };
}

export function startSession(
  guildId: string,
  openedBy: string,
  onExpire: (session: { openedBy: string; memberIds: string[] }) => void
): { started: boolean; alreadyActive: boolean; openedBy?: string } {
  const existing = sessions.get(guildId);
  if (existing) {
    return { started: false, alreadyActive: true, openedBy: existing.openedBy };
  }
  const expiryTimer = setTimeout(() => {
    const s = sessions.get(guildId);
    if (!s) return;
    sessions.delete(guildId);
    logger.warn(
      { guildId, openedBy: s.openedBy, bufferedCount: s.members.length },
      "[welcomeBatch] session auto-expired after idle timeout"
    );
    try {
      onExpire({ openedBy: s.openedBy, memberIds: s.members.map((m) => m.id) });
    } catch (err) {
      logger.warn({ err, guildId }, "[welcomeBatch] onExpire callback failed");
    }
  }, WELCOME_BATCH_EXPIRY_MS);

  sessions.set(guildId, {
    guildId,
    members: [],
    openedBy,
    openedAt: Date.now(),
    expiryTimer,
  });
  logger.info({ guildId, openedBy }, "[welcomeBatch] session started");
  return { started: true, alreadyActive: false };
}

/**
 * tryEnqueueWelcome
 * WHAT: If a session is active for this guild, push the member into the buffer and
 *       return true. Caller should NOT post a welcome card.
 *       If no session is active, return false. Caller should post a welcome card normally.
 * WHY: Single hook point at every approval site.
 */
export function tryEnqueueWelcome(member: GuildMember): boolean {
  const s = sessions.get(member.guild.id);
  if (!s) return false;
  if (s.members.length >= WELCOME_BATCH_MAX_USERS) {
    logger.warn(
      { guildId: member.guild.id, userId: member.id, cap: WELCOME_BATCH_MAX_USERS },
      "[welcomeBatch] buffer full, dropping enqueue (caller will post solo welcome)"
    );
    return false;
  }
  if (s.members.some((m) => m.id === member.id)) {
    logger.debug(
      { guildId: member.guild.id, userId: member.id },
      "[welcomeBatch] duplicate enqueue ignored"
    );
    return true;
  }
  s.members.push(member);
  logger.info(
    { guildId: member.guild.id, userId: member.id, bufferedCount: s.members.length },
    "[welcomeBatch] enqueued user"
  );
  return true;
}

export type FlushResult =
  | { kind: "no_session" }
  | { kind: "empty"; openedBy: string }
  | { kind: "sent"; userCount: number }
  | { kind: "error"; userCount: number; error: string };

export async function flushSession(
  guild: Guild,
  config: GuildConfig
): Promise<FlushResult> {
  const s = sessions.get(guild.id);
  if (!s) return { kind: "no_session" };

  if (s.members.length === 0) {
    clearTimeout(s.expiryTimer);
    sessions.delete(guild.id);
    logger.info({ guildId: guild.id, openedBy: s.openedBy }, "[welcomeBatch] flush with empty buffer, session closed");
    return { kind: "empty", openedBy: s.openedBy };
  }

  const memberCount = guild.memberCount;
  const usersToSend = [...s.members];
  clearTimeout(s.expiryTimer);
  sessions.delete(guild.id);

  try {
    if (usersToSend.length === 1) {
      await postWelcomeCard({ guild, user: usersToSend[0]!, config, memberCount });
    } else {
      await postBatchWelcomeCard({ guild, users: usersToSend, config, memberCount });
    }
    logger.info(
      { guildId: guild.id, userCount: usersToSend.length },
      "[welcomeBatch] flushed batch welcome"
    );
    return { kind: "sent", userCount: usersToSend.length };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      { err, guildId: guild.id, userCount: usersToSend.length },
      "[welcomeBatch] flush failed"
    );
    return { kind: "error", userCount: usersToSend.length, error: errorMsg };
  }
}

/**
 * isMemberBuffered
 * WHAT: Returns true if the given member is currently in the active batch.
 * WHY: Lets the right-click context menu decide between "add" and "send".
 */
export function isMemberBuffered(guildId: string, memberId: string): boolean {
  const s = sessions.get(guildId);
  if (!s) return false;
  return s.members.some((m) => m.id === memberId);
}

export type AddMemberResult =
  | { kind: "started"; bufferedCount: number }
  | { kind: "added"; bufferedCount: number }
  | { kind: "already_buffered"; bufferedCount: number }
  | { kind: "full"; bufferedCount: number }
  | { kind: "denied_other_opener"; openedBy: string };

/**
 * addMember
 * WHAT: Auto-starts a session if none is open, then enqueues the member.
 * WHY: Single entry point for the right-click "Welcome Batch" context menu so
 *      the caller does not need to know whether a session already exists.
 * RULES:
 *  - If no session: start one owned by openedBy, then enqueue.
 *  - If session belongs to a different mod: deny (avoids stomping their queue).
 *  - If session is at the cap: report full so the caller can fall back.
 */
export function addMember(
  member: GuildMember,
  openedBy: string,
  onExpire: (session: { openedBy: string; memberIds: string[] }) => void
): AddMemberResult {
  const guildId = member.guild.id;
  let s = sessions.get(guildId);
  let started = false;
  if (!s) {
    startSession(guildId, openedBy, onExpire);
    s = sessions.get(guildId);
    started = true;
  }
  if (!s) {
    // Defensive: startSession should always populate. Treat as full to fall back.
    return { kind: "full", bufferedCount: 0 };
  }
  if (s.openedBy !== openedBy) {
    return { kind: "denied_other_opener", openedBy: s.openedBy };
  }
  if (s.members.some((m) => m.id === member.id)) {
    return { kind: "already_buffered", bufferedCount: s.members.length };
  }
  if (s.members.length >= WELCOME_BATCH_MAX_USERS) {
    return { kind: "full", bufferedCount: s.members.length };
  }
  s.members.push(member);
  logger.info(
    { guildId, userId: member.id, bufferedCount: s.members.length, viaContext: true },
    "[welcomeBatch] member added via context menu"
  );
  return { kind: started ? "started" : "added", bufferedCount: s.members.length };
}

export function cancelSession(guildId: string): { cancelled: boolean; bufferedCount: number; openedBy?: string } {
  const s = sessions.get(guildId);
  if (!s) return { cancelled: false, bufferedCount: 0 };
  clearTimeout(s.expiryTimer);
  sessions.delete(guildId);
  logger.info(
    { guildId, openedBy: s.openedBy, bufferedCount: s.members.length },
    "[welcomeBatch] session cancelled"
  );
  return { cancelled: true, bufferedCount: s.members.length, openedBy: s.openedBy };
}
