/**
 * Pawtropolis Tech -- src/features/artistInvestigation/serverContext.ts
 * WHAT: What the server already knows about an applicant: account age, join
 *       date, roles, recent activity, gate application, earlier verification
 *       tickets and the staff Verify Blacklist.
 * WHY: The handbook's red and green flags lean on history ("Account <6 months
 *      old with no traceable history"). Each lookup is independent: one that
 *      cannot be read is listed as a gap instead of failing the run or being
 *      passed off as a clean result.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import type { Guild } from "discord.js";
import {
  ARTIST_TICKET_TYPE_KEY,
  LIMITS,
  getArtistLogChannelId,
  getVerifyBlacklistThreadId,
} from "./config.js";
import type { ApplicantContext, PriorTicket } from "./types.js";

const DISCORD_EPOCH_MS = 1420070400000n;

/** Creation time encoded in any Discord id. */
export function snowflakeToMs(id: string): number {
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH_MS);
}

/** The parts of a log or forum message this module reads. */
export interface StaffMessage {
  id: string;
  createdTimestamp: number;
  content: string;
  embeds: ReadonlyArray<{ fields: ReadonlyArray<{ name: string; value: string }> }>;
}

interface ReadableChannel {
  messages: {
    fetch(options: { limit: number; before?: string }): Promise<{ values(): Iterable<StaffMessage> }>;
  };
}

async function readRecent(channel: ReadableChannel, pages: number): Promise<{ messages: StaffMessage[]; reachedStart: boolean }> {
  const messages: StaffMessage[] = [];
  let before: string | undefined;
  for (let page = 0; page < pages; page++) {
    const batch = [...(await channel.messages.fetch(before ? { limit: 100, before } : { limit: 100 })).values()];
    messages.push(...batch);
    if (batch.length < 100) return { messages, reachedStart: true };
    before = batch.reduce((oldest, m) => (BigInt(m.id) < BigInt(oldest.id) ? m : oldest)).id;
  }
  return { messages, reachedStart: false };
}

/**
 * Earlier tickets from Ticket Tool's transcript posts. Each closed ticket leaves
 * an embed with "Ticket Owner" and "Ticket Name" fields.
 */
export function priorTicketsFromLog(messages: Iterable<StaffMessage>, applicantId: string, currentChannelName: string): PriorTicket[] {
  const found = new Map<string, PriorTicket>();
  for (const message of messages) {
    for (const embed of message.embeds) {
      const field = (name: string) => embed.fields.find((f) => f.name === name)?.value ?? "";
      const name = field("Ticket Name").trim();
      if (!name || name === currentChannelName || !field("Ticket Owner").includes(applicantId)) continue;
      found.set(name, {
        name,
        when: new Date(message.createdTimestamp).toISOString(),
        note: "closed, transcript on file in the ticket log",
        source: "ticket-tool-log",
      });
    }
  }
  return [...found.values()];
}

/** The staff note naming this user in the Verify Blacklist thread, if there is one. */
export function blacklistEntry(messages: Iterable<StaffMessage>, applicantId: string): string | null {
  const mention = new RegExp(`<@!?${applicantId}>`);
  for (const message of messages) {
    if (!mention.test(message.content)) continue;
    const note = message.content.replace(/<@!?\d+>/g, "").replace(/\s+/g, " ").replace(/^[\s-]+/, "").trim();
    const date = new Date(message.createdTimestamp).toISOString().slice(0, 10);
    return `${date}: ${note.slice(0, 300) || "listed without a note"}`;
  }
  return null;
}

const describe = (err: unknown) => (err instanceof Error ? err.message : "unknown error").slice(0, 120);

/** Stands in for the username when the profile cannot be read. Never use it as a name to match on. */
export const UNKNOWN_USERNAME = "unknown";

export interface ContextInput {
  guild: Guild;
  applicantId: string;
  channelId: string;
  channelName: string;
  db: Database;
}

export async function gatherApplicantContext(input: ContextInput): Promise<ApplicantContext> {
  const { guild, applicantId, db } = input;
  const context: ApplicantContext = {
    userId: applicantId,
    username: UNKNOWN_USERNAME,
    globalName: null,
    nickname: null,
    accountCreatedAtMs: snowflakeToMs(applicantId),
    joinedAtMs: null,
    inServer: null,
    roles: [],
    recentMessageCount: null,
    lastSeenAtMs: null,
    gateApplication: null,
    priorTickets: [],
    onVerifyBlacklist: null,
    blacklistNote: null,
    gaps: [],
  };

  try {
    const user = await guild.client.users.fetch(applicantId);
    context.username = user.username;
    context.globalName = user.globalName ?? null;
  } catch (err) {
    context.gaps.push(`Discord profile could not be read (${describe(err)}).`);
  }

  try {
    const member = await guild.members.fetch(applicantId);
    context.inServer = true;
    context.joinedAtMs = member.joinedTimestamp;
    context.nickname = member.nickname;
    context.roles = [...member.roles.cache.values()]
      .filter((role) => role.id !== guild.id)
      .sort((a, b) => b.position - a.position)
      .map((role) => role.name);
  } catch (err) {
    // 10007 is Discord's "Unknown Member": the account exists but has left.
    if ((err as { code?: number }).code === 10007) context.inServer = false;
    else context.gaps.push(`Server membership could not be read (${describe(err)}).`);
  }

  try {
    // No (guild_id, user_id) index backs this, so it scans the guild's rows: about
    // 0.7 s on production data. An index was measured and rejected because it
    // triples the cost of every message insert, and this runs once per owner command.
    const activity = db
      .prepare(`SELECT COUNT(*) AS n, MAX(created_at_s) AS last FROM message_activity WHERE guild_id = ? AND user_id = ?`)
      .get(guild.id, applicantId) as { n: number; last: number | null };
    context.recentMessageCount = activity.n;
    context.lastSeenAtMs = activity.last === null ? null : activity.last * 1000;

    const application = db
      .prepare(
        `SELECT status, submitted_at FROM application WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(guild.id, applicantId) as { status: string; submitted_at: string | null } | undefined;
    context.gateApplication = application ? { status: application.status, submittedAt: application.submitted_at } : null;

    const tickets = db
      .prepare(
        `SELECT number, status, close_reason, opened_at FROM ticket
         WHERE guild_id = ? AND opener_user_id = ? AND type_key = ? AND channel_id != ?
         ORDER BY opened_at DESC LIMIT 10`
      )
      .all(guild.id, applicantId, ARTIST_TICKET_TYPE_KEY, input.channelId) as Array<{
      number: number;
      status: string;
      close_reason: string | null;
      opened_at: number;
    }>;
    context.priorTickets.push(
      ...tickets.map<PriorTicket>((t) => ({
        name: `${ARTIST_TICKET_TYPE_KEY}-${String(t.number).padStart(4, "0")}`,
        when: new Date(t.opened_at * 1000).toISOString(),
        note: t.status === "closed" ? `closed${t.close_reason ? `: ${t.close_reason.slice(0, 120)}` : ""}` : "still open",
        source: "first-party",
      }))
    );
  } catch (err) {
    context.gaps.push(`Bot database records could not be read (${describe(err)}).`);
  }

  const logChannelId = getArtistLogChannelId(guild.id);
  if (logChannelId) {
    try {
      const channel = await guild.channels.fetch(logChannelId);
      if (!channel?.isTextBased()) throw new Error("log channel is not readable");
      const log = await readRecent(channel as unknown as ReadableChannel, LIMITS.logPages);
      context.priorTickets.push(...priorTicketsFromLog(log.messages, applicantId, input.channelName));
      if (!log.reachedStart) {
        const oldest = Math.min(...log.messages.map((m) => m.createdTimestamp));
        context.gaps.push(`Ticket log was read back to ${new Date(oldest).toISOString().slice(0, 10)} only; older tickets are not counted.`);
      }
    } catch (err) {
      context.gaps.push(`Ticket log could not be read, so earlier Ticket Tool tickets are unknown (${describe(err)}).`);
    }
  } else {
    context.gaps.push("No ticket log channel is configured for this server, so earlier Ticket Tool tickets are unknown.");
  }

  const blacklistThreadId = getVerifyBlacklistThreadId(guild.id);
  if (blacklistThreadId) {
    try {
      const thread = await guild.client.channels.fetch(blacklistThreadId);
      if (!thread?.isTextBased()) throw new Error("thread is not readable");
      const { messages, reachedStart } = await readRecent(thread as unknown as ReadableChannel, LIMITS.blacklistPages);
      context.blacklistNote = blacklistEntry(messages, applicantId);
      context.onVerifyBlacklist = context.blacklistNote !== null ? true : reachedStart ? false : null;
      if (context.onVerifyBlacklist === null) context.gaps.push("Verify Blacklist is longer than the part that was read; no entry was found in the newest messages.");
    } catch (err) {
      context.gaps.push(`Verify Blacklist could not be read (${describe(err)}).`);
    }
  } else {
    context.gaps.push("No Verify Blacklist thread is configured for this server.");
  }

  return context;
}
