/**
 * Pawtropolis Tech — src/features/gate/threadGate.ts
 *
 * WHAT: Per-user private verify thread infrastructure. When a member joins
 *       the guild, the bot creates a private thread for them under a hidden
 *       parent channel, adds only that user to it, posts the server rules
 *       (replicated from the configured `unverified_rules_channel_id`), and
 *       posts the existing Verify button. The user reads the rules and clicks
 *       Verify — at which point the existing dmVerification flow takes over,
 *       running INSIDE the thread (no DMs are sent).
 *
 * WHY:  Replaces the public-facing `[13] Unverified Area` lobby. In the old
 *       lobby, scammers could enumerate other unverified users via the
 *       channel member sidebar and DM them before they finished verifying.
 *       Private threads are invisible to anyone except the joining user (and
 *       staff with ManageThreads, who don't get notifications). The lobby
 *       category gets `@everyone` View denied after a one-shot migration of
 *       existing unverified users runs.
 *
 * POLICY: This handler does NOT send any direct messages. The bot's only
 *         "auto" actions are (a) creating a private thread and (b) adding
 *         the joining user to it — both standard Discord operations that
 *         dozens of major bots (modmail, captcha, etc.) perform on join.
 *         The user explicitly opts in to verification by clicking the Verify
 *         button. Discord Developer Policy Rule 5 ("no unsolicited DMs") and
 *         Rule 2 ("no initiated processes without consent") are both
 *         satisfied — there's no DM and the verification flow only starts on
 *         user click.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ChannelType,
  type BaseMessageOptions,
  type Client,
  type Guild,
  type GuildMember,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { getConfig } from "../../lib/config.js";
import { buildGateEntryPayload } from "../gate.js";
import { getUnverifiedRules } from "./rulesCache.js";

// ============================================================================
// Types & DB helpers
// ============================================================================

interface VerifyThreadRow {
  guild_id: string;
  user_id: string;
  thread_id: string;
  state: string;
  created_at: number;
  resolved_at: number | null;
}

function getVerifyThreadForUser(
  guildId: string,
  userId: string
): VerifyThreadRow | undefined {
  return db
    .prepare(
      `SELECT guild_id, user_id, thread_id, state, created_at, resolved_at
         FROM verify_thread WHERE guild_id = ? AND user_id = ?`
    )
    .get(guildId, userId) as VerifyThreadRow | undefined;
}

export function getVerifyThreadByThreadId(threadId: string): VerifyThreadRow | undefined {
  return db
    .prepare(
      `SELECT guild_id, user_id, thread_id, state, created_at, resolved_at
         FROM verify_thread WHERE thread_id = ?`
    )
    .get(threadId) as VerifyThreadRow | undefined;
}

function upsertVerifyThreadRow(
  guildId: string,
  userId: string,
  threadId: string,
  state: string
): void {
  db.prepare(
    `INSERT INTO verify_thread (guild_id, user_id, thread_id, state)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(guild_id, user_id) DO UPDATE SET
         thread_id = excluded.thread_id,
         state = excluded.state`
  ).run(guildId, userId, threadId, state);
}

function deleteVerifyThreadRow(guildId: string, userId: string): void {
  db.prepare(`DELETE FROM verify_thread WHERE guild_id = ? AND user_id = ?`).run(guildId, userId);
}

// ============================================================================
// Rules content rendering
// ============================================================================

function buildContentWithAttachments(content: string, urls: string[]): string {
  if (urls.length === 0) return content;
  const parts: string[] = [];
  if (content) parts.push(content);
  for (const u of urls) parts.push(u);
  const joined = parts.join("\n");
  // Discord message content cap = 2000 chars
  return joined.length > 2000 ? joined.slice(0, 1997) + "..." : joined;
}

async function postRulesIntoThread(
  thread: ThreadChannel,
  client: Client,
  guildId: string,
  rulesChannelId: string
): Promise<void> {
  const rules = await getUnverifiedRules(client, guildId, rulesChannelId);
  if (rules.length === 0) {
    logger.warn(
      { guildId, rulesChannelId, threadId: thread.id },
      "[threadGate] rules channel returned 0 messages"
    );
    return;
  }
  for (const r of rules) {
    const content = buildContentWithAttachments(r.content, r.attachmentUrls);
    const payload: BaseMessageOptions = {
      allowedMentions: { parse: [] }, // strip all mentions to avoid pinging staff/roles
    };
    if (content) payload.content = content;
    if (r.embeds.length > 0) payload.embeds = r.embeds;
    if (!payload.content && (!payload.embeds || payload.embeds.length === 0)) continue;
    try {
      await thread.send(payload);
    } catch (err) {
      logger.warn(
        { err, threadId: thread.id, guildId },
        "[threadGate] failed to post a rules message"
      );
    }
    // Pace under Discord's per-channel rate limit (5 msgs / 5s)
    await new Promise((res) => setTimeout(res, 250));
  }
}

// ============================================================================
// Main entry point: guildMemberAdd handler
// ============================================================================

/**
 * Called from src/index.ts on guildMemberAdd. Short-circuits if the feature
 * isn't configured for this guild (verify_thread_parent_id is null).
 */
export async function handleMemberJoin(member: GuildMember): Promise<void> {
  const guildId = member.guild.id;
  const userId = member.id;

  // Bots don't go through verification
  if (member.user.bot) return;

  const cfg = getConfig(guildId);
  const parentChannelId = cfg?.verify_thread_parent_id;
  if (!parentChannelId) {
    // Feature not configured — bot's existing behavior unchanged
    return;
  }

  // Idempotency: existing row → reuse the thread
  const existing = getVerifyThreadForUser(guildId, userId);
  if (existing) {
    try {
      const fetched = await member.guild.channels.fetch(existing.thread_id);
      if (fetched && fetched.isThread()) {
        // Re-add user (no-op if already a member, important for re-joins)
        await fetched.members.add(userId).catch(() => {
          /* already a member or other no-op */
        });
        logger.info(
          { guildId, userId, threadId: fetched.id },
          "[threadGate] reused existing verify thread on rejoin"
        );
        return;
      }
    } catch {
      // Thread missing/inaccessible — drop the stale row and fall through
      deleteVerifyThreadRow(guildId, userId);
    }
  }

  await createVerifyThreadForUser(member, parentChannelId, cfg.unverified_rules_channel_id ?? null);
}

// ============================================================================
// Thread creation
// ============================================================================

async function createVerifyThreadForUser(
  member: GuildMember,
  parentChannelId: string,
  rulesChannelId: string | null
): Promise<ThreadChannel | null> {
  const guildId = member.guild.id;
  const userId = member.id;
  const client = member.client;

  // Fetch parent channel
  let parent: TextChannel | null = null;
  try {
    const fetched = await client.channels.fetch(parentChannelId);
    if (fetched && fetched.type === ChannelType.GuildText) {
      parent = fetched as TextChannel;
    }
  } catch (err) {
    logger.error({ err, guildId, parentChannelId }, "[threadGate] failed to fetch parent channel");
    return null;
  }
  if (!parent) {
    logger.error(
      { guildId, parentChannelId },
      "[threadGate] parent channel not found or not a text channel"
    );
    return null;
  }

  // Create the private thread
  let thread: ThreadChannel;
  try {
    thread = await parent.threads.create({
      name: `verify-${userId.slice(-6)}`,
      type: ChannelType.PrivateThread,
      autoArchiveDuration: 60, // 1 hour
      invitable: false,
      reason: `Verify thread for ${member.user.tag} (${userId})`,
    });
  } catch (err) {
    logger.error(
      { err, guildId, userId, parentChannelId },
      "[threadGate] failed to create thread"
    );
    return null;
  }

  // Add the joining user (Discord auto-notifies them)
  try {
    await thread.members.add(userId);
  } catch (err) {
    logger.warn(
      { err, guildId, userId, threadId: thread.id },
      "[threadGate] failed to add user to thread (continuing — they may still see it via notification)"
    );
  }

  upsertVerifyThreadRow(guildId, userId, thread.id, "created");

  // Welcome message (mentions user → second independent ping)
  try {
    await thread.send({
      content:
        `Hi <@${userId}>! 👋\n\n` +
        `Welcome to **${member.guild.name}**. Before you can chat in the server, please ` +
        `read the rules below and click the **Verify** button at the bottom to start ` +
        `verification. The bot will ask a few quick questions, then staff will review ` +
        `your application.\n\n` +
        `This thread is private — only you and staff can see it.`,
      allowedMentions: { users: [userId], parse: [] },
    });
  } catch (err) {
    logger.warn(
      { err, guildId, userId, threadId: thread.id },
      "[threadGate] failed to post welcome message"
    );
  }

  // Replicated rules
  if (rulesChannelId) {
    try {
      await postRulesIntoThread(thread, client, guildId, rulesChannelId);
      upsertVerifyThreadRow(guildId, userId, thread.id, "rules_posted");
    } catch (err) {
      logger.warn(
        { err, guildId, threadId: thread.id, rulesChannelId },
        "[threadGate] failed to post rules block"
      );
    }
  }

  // Verify panel (the existing buildGateEntryPayload — same embed + button as `「❓」verify`)
  try {
    const cfg = getConfig(guildId);
    if (cfg) {
      const payload = buildGateEntryPayload({ guild: member.guild, config: cfg });
      await thread.send({
        embeds: payload.embeds,
        components: payload.components,
        files: payload.files,
        allowedMentions: { parse: [] },
      });
      upsertVerifyThreadRow(guildId, userId, thread.id, "verify_panel_posted");
    }
  } catch (err) {
    logger.error(
      { err, guildId, userId, threadId: thread.id },
      "[threadGate] failed to post verify panel"
    );
  }

  logger.info(
    { guildId, userId, threadId: thread.id },
    "[threadGate] per-user verify thread ready"
  );
  return thread;
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Called from review flow approve / reject / kick handlers and from
 * guildMemberRemove. Posts a final message in the thread (optional) then
 * either deletes or archives based on the resolution reason.
 */
export async function cleanupVerifyThreadForUser(
  client: Client,
  guildId: string,
  userId: string,
  reason: "approved" | "rejected" | "permanently_rejected" | "kicked" | "left_server",
  finalMessage?: string
): Promise<void> {
  const row = getVerifyThreadForUser(guildId, userId);
  if (!row) return;

  let thread: ThreadChannel | null = null;
  try {
    const fetched = await client.channels.fetch(row.thread_id);
    if (fetched && fetched.isThread()) {
      thread = fetched as ThreadChannel;
    }
  } catch {
    /* fall through to row cleanup */
  }
  if (!thread) {
    deleteVerifyThreadRow(guildId, userId);
    return;
  }

  // Post the final message inside the thread (visible to the user before deletion/archive)
  if (finalMessage) {
    try {
      await thread.send({ content: finalMessage, allowedMentions: { parse: [] } });
    } catch (err) {
      logger.warn(
        { err, guildId, userId, threadId: thread.id, reason },
        "[threadGate] failed to post final message"
      );
    }
  }

  if (reason === "approved") {
    // Brief grace period for user to read the welcome before the thread vanishes
    setTimeout(() => {
      thread!
        .delete(`Verify thread cleanup: ${reason}`)
        .catch((err) =>
          logger.warn(
            { err, guildId, userId, threadId: thread!.id },
            "[threadGate] delayed delete failed"
          )
        );
    }, 60_000);
    deleteVerifyThreadRow(guildId, userId);
    return;
  }

  if (reason === "kicked" || reason === "left_server") {
    try {
      await thread.delete(`Verify thread cleanup: ${reason}`);
    } catch (err) {
      logger.warn(
        { err, guildId, userId, threadId: thread.id, reason },
        "[threadGate] thread delete failed"
      );
    }
    deleteVerifyThreadRow(guildId, userId);
    return;
  }

  // rejected / permanently_rejected — keep the thread visible to user, archive after 24h
  try {
    await thread.edit({ autoArchiveDuration: 1440 });
    await thread.setArchived(true);
  } catch (err) {
    logger.warn(
      { err, guildId, userId, threadId: thread.id, reason },
      "[threadGate] failed to archive thread"
    );
  }
  db.prepare(
    `UPDATE verify_thread SET state = ?, resolved_at = unixepoch() WHERE guild_id = ? AND user_id = ?`
  ).run(reason, guildId, userId);
}

// ============================================================================
// One-shot bulk migration of existing unverified members
// ============================================================================

/**
 * Walks every non-bot member of the guild that does not yet have the
 * `accepted_role_id`, and creates a per-user verify thread for each. Idempotent
 * via the verify_thread PRIMARY KEY (existing rows are skipped).
 *
 * Intended to be called ONCE during the rollout of the per-user thread system,
 * BEFORE staff manually deny @everyone View on the public lobby category. This
 * ensures every existing unverified user already has a thread before they lose
 * lobby access — they receive Discord's "added to a thread" notification and
 * have a clear path to verification.
 *
 * Triggered from src/index.ts ClientReady when `RUN_THREAD_MIGRATION=1` is set
 * in the environment. After successful completion, the env var should be unset
 * so the migration doesn't re-run on every restart (it would be a no-op due to
 * the verify_thread PK, but it's wasted work).
 */
export async function runThreadMigrationForUnverified(
  guild: Guild
): Promise<{ created: number; skipped: number; failed: number; total: number }> {
  const guildId = guild.id;
  const cfg = getConfig(guildId);

  if (!cfg?.verify_thread_parent_id) {
    logger.warn(
      { guildId },
      "[threadMigration] verify_thread_parent_id not configured, skipping"
    );
    return { created: 0, skipped: 0, failed: 0, total: 0 };
  }
  if (!cfg.accepted_role_id) {
    logger.warn({ guildId }, "[threadMigration] accepted_role_id not configured, skipping");
    return { created: 0, skipped: 0, failed: 0, total: 0 };
  }

  logger.info({ guildId }, "[threadMigration] starting bulk migration of unverified members");

  // The member cache is complete (GuildMembers intent, uncapped cache, fetched at boot).
  const allMembers = guild.members.cache;

  const acceptedRoleId = cfg.accepted_role_id;
  const targets: GuildMember[] = [];
  for (const m of allMembers.values()) {
    if (m.user.bot) continue;
    if (m.roles.cache.has(acceptedRoleId)) continue;
    targets.push(m);
  }

  logger.info(
    { guildId, total: targets.length, totalMembers: allMembers.size },
    "[threadMigration] found unverified members to process"
  );

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const target of targets) {
    try {
      // Idempotency: skip if a thread row already exists
      const existing = getVerifyThreadForUser(guildId, target.id);
      if (existing) {
        skipped++;
      } else {
        await handleMemberJoin(target);
        created++;
      }
    } catch (err) {
      failed++;
      logger.warn(
        { err, userId: target.id, guildId },
        "[threadMigration] handleMemberJoin failed for user"
      );
    }

    // Progress checkpoint every 10 users
    const processed = created + skipped + failed;
    if (processed % 10 === 0) {
      logger.info(
        { guildId, processed, total: targets.length, created, skipped, failed },
        "[threadMigration] progress"
      );
    }

    // Pace ~1/sec to stay well under Discord's per-channel thread-create rate
    // limit (5 / 5s) and to give the bot's other event handlers time to run
    if (processed < targets.length) {
      await new Promise((res) => setTimeout(res, 1000));
    }
  }

  logger.info(
    { guildId, total: targets.length, created, skipped, failed },
    "[threadMigration] complete"
  );
  return { created, skipped, failed, total: targets.length };
}
