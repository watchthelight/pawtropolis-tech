/**
 * Pawtropolis Tech — src/events/guildEvents.ts
 * WHAT: Guild lifecycle + cache-sync event handlers — guild join/leave, member
 *       add/remove/update, voice state, channel/role create-update-delete,
 *       ticket-transcript + message-archive capture, and invite tracking.
 * WHY: Extracted from index.ts (#00007) to keep the entrypoint a thin bootstrap.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { type Client, REST, Routes } from "discord.js";
import { logger } from "../lib/logger.js";
import { wrapEvent } from "../lib/eventWrap.js";
import { env } from "../lib/env.js";
import { db } from "../db/db.js";
import { syncCommandsToGuild } from "../commands/sync.js";
import { logActionPretty } from "../logging/pretty.js";
import { notifyDashboard } from "../web/notifyDashboard.js";
import { OPEN_MODMAIL_THREADS } from "../features/modmail.js";
import { handleLevelRoleAdded } from "../features/levelRewards.js";
import { handleArtistRoleChange } from "../features/artistRotation/index.js";
import { handleAvatarChange } from "../features/avatarNsfwMonitor.js";
import { handlePatreonRoleDedup, isPatreonDonorRole } from "../features/patreonRoleDedup.js";
import {
  getActiveMovieEvent,
  handleMovieVoiceJoin,
  handleMovieVoiceLeave,
} from "../features/movieNight.js";
import {
  getActiveGameEvent,
  handleGameVoiceJoin,
  handleGameVoiceLeave,
} from "../features/events/gameNight.js";
import { handleVoiceStateUpdate } from "../features/voiceSessionTracker.js";
import { syncChannel, removeChannel } from "../features/channelCacheSync.js";
import { syncRole, removeRole } from "../features/roleCacheSync.js";
import { captureMessage, markMessageDeleted } from "../features/tickets/transcript.js";
import * as archive from "../features/messageArchive.js";
import { handleInviteCreate, handleInviteDelete } from "../features/inviteTracker.js";

export function registerGuildEvents(client: Client): void {
client.on("guildCreate", wrapEvent("guildCreate", async (guild) => {
  // Only allow the configured guild - auto-leave any other server
  const allowedGuild = env.GUILD_ID ?? "896070888594759740";
  if (guild.id !== allowedGuild) {
    logger.info({ guildId: guild.id, guildName: guild.name }, "[guild] auto-leaving unauthorized server");
    await guild.leave();
    return;
  }
  await syncCommandsToGuild(guild.id);
}));

// Optional: Clear commands on guildDelete to avoid leaving stale commands.
// Docs: https://discord.js.org/#/docs/discord.js/main/class/Client?scrollTo=e-guildDelete
client.on("guildDelete", wrapEvent("guildDelete", async (guild) => {
  // goodbye, old friend
  // Overwrite with empty array to clear commands.
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(env.CLIENT_ID, guild.id), {
    body: [],
  });
  logger.info({ guildId: guild.id }, "[cmdsync] cleared commands for removed guild");

  // Cleanup guild-specific caches to prevent memory leaks (Issue #86)
  // WHAT: Remove in-memory cache entries for departed guild
  // WHY: Prevents unbounded memory growth from accumulating stale entries
  // NOTE: DB rows are preserved in case bot rejoins the guild
  try {
    const { clearPanicCache } = await import("../features/panicStore.js");
    const { clearConfigCache } = await import("../lib/config.js");
    const { clearLoggingCache } = await import("../config/loggingStore.js");
    const { clearFlaggerCache } = await import("../config/flaggerStore.js");

    clearPanicCache(guild.id);
    clearConfigCache(guild.id);
    clearLoggingCache(guild.id);
    clearFlaggerCache(guild.id);

    logger.info({ guildId: guild.id }, "[guildDelete] Cleared all caches for departed guild");
  } catch (err) {
    logger.warn({ err, guildId: guild.id }, "[guildDelete] Cache cleanup failed (non-fatal)");
  }
}));

// Track member joins for join→submit ratio metrics + activity tracking (PR8)
// WHY: Enables analysis of verification funnel (how many joiners attempt verification)
// WHY (PR8): Track joined_at timestamp for Silent-Since-Join detection
// DOCS: https://discord.js.org/#/docs/discord.js/main/class/Client?scrollTo=e-guildMemberAdd
client.on("guildMemberAdd", wrapEvent("guildMemberAdd", async (member) => {
  if (!member.guild) return;

  await logActionPretty(member.guild, {
    actorId: member.id,
    action: "member_join",
  });

  logger.debug({ userId: member.id, guildId: member.guild.id }, "[metrics] member join logged");

  // Cache user identity for dashboard display
  try {
    const { cacheUser } = await import("../lib/userCache.js");
    cacheUser(member.user, member.guild.id, member);
  } catch (err) {
    logger.debug({ err, userId: member.id }, "[guildMemberAdd] failed to cache user");
  }

  // Track join for Silent-Since-Join detection (PR8)
  const { trackJoin } = await import("../features/activityTracker.js");
  const joinedAt = Math.floor((member.joinedTimestamp || Date.now()) / 1000);
  trackJoin(member.guild.id, member.id, joinedAt);

  // Scan avatar for NSFW content on join
  // WHY: Catch NSFW avatars immediately when members join
  try {
    const { handleMemberJoin } = await import("../features/avatarNsfwMonitor.js");
    await handleMemberJoin(member);
  } catch (err) {
    logger.error({
      err,
      userId: member.id,
      guildId: member.guild.id,
    }, "[guildMemberAdd] Failed to scan avatar for NSFW");
  }

  // Track which invite the new member used (growth source attribution)
  try {
    const { trackMemberInvite } = await import("../features/inviteTracker.js");
    await trackMemberInvite(member);
  } catch (err) {
    logger.debug({ err, userId: member.id }, "[guildMemberAdd] Invite tracking failed (non-fatal)");
  }

  // Create per-user private verify thread (replaces public lobby — closes the
  // scammer-discovery vector where unverified users could see each other in
  // the lobby's member sidebar). Short-circuits if verify_thread_parent_id
  // isn't configured for this guild.
  try {
    const { handleMemberJoin } = await import("../features/gate/threadGate.js");
    await handleMemberJoin(member);
  } catch (err) {
    logger.error(
      { err, userId: member.id, guildId: member.guild.id },
      "[guildMemberAdd] verify thread creation failed"
    );
  }
}));

// REVIEW CARD: Refresh pending apps when user leaves server
// WHY: Shows "Left server" warning on review cards so moderators know user is no longer in server
// DOCS: https://discord.js.org/#/docs/discord.js/main/class/Client?scrollTo=e-guildMemberRemove
client.on("guildMemberRemove", wrapEvent("guildMemberRemove", async (member) => {
  if (!member.guild) return;
  const guildId = member.guild.id;
  const userId = member.id;

  // ROLE SNAPSHOT: capture roles before any later code runs, so a downstream
  // failure can't lose the snapshot. Audit-log classification runs async.
  try {
    const { snapshotMemberRoles, classifyRemoval } = await import("../features/roleSnapshot.js");
    const snapshotId = snapshotMemberRoles(member);
    if (snapshotId) {
      classifyRemoval(member.guild, userId, snapshotId).catch((err) =>
        logger.warn({ err, guildId, userId }, "[roleSnapshot] classify failed")
      );
    }
  } catch (err) {
    logger.warn({ err, guildId, userId }, "[roleSnapshot] snapshot failed");
  }

  // Clean up any active DM verification session
  const { cleanupSession } = await import("../features/gate/dmVerification.js");
  cleanupSession(guildId, userId);

  // Append-only leave event (mirrors member_join): one immutable row per leave
  // in action_log, so churn metrics never change retroactively on rejoin.
  await logActionPretty(member.guild, {
    actorId: userId,
    action: "member_leave",
  });

  // Track member departure in user_activity
  const { trackLeave } = await import("../features/activityTracker.js");
  trackLeave(guildId, userId);

  // Auto-dismiss flags for departed members — no point reviewing flags for users who left/were banned
  try {
    const nsfwResult = db.prepare("UPDATE nsfw_flags SET reviewed = 1, reviewed_by = 'system', reviewed_at = datetime('now') WHERE guild_id = ? AND user_id = ? AND reviewed = 0").run(guildId, userId);
    const behavResult = db.prepare("UPDATE user_activity SET flagged_at = NULL, flagged_reason = NULL, manual_flag = 0, flagged_by = NULL WHERE guild_id = ? AND user_id = ? AND flagged_at IS NOT NULL").run(guildId, userId);
    if (nsfwResult.changes > 0 || behavResult.changes > 0) {
      logger.info({ guildId, userId, nsfwDismissed: nsfwResult.changes, behavDismissed: behavResult.changes }, "[guildMemberRemove] auto-dismissed flags for departed member");
      if (nsfwResult.changes > 0) notifyDashboard("flag:dismissed", { userId, flagType: "nsfw" });
      if (behavResult.changes > 0) notifyDashboard("flag:dismissed", { userId, flagType: "behavioral" });
    }
  } catch (err) {
    logger.warn({ err, guildId, userId }, "[guildMemberRemove] failed to auto-dismiss flags");
  }

  // Find pending applications for this user
  const pendingApps = db.prepare(`
    SELECT id FROM application
    WHERE guild_id = ? AND user_id = ? AND status = 'submitted'
  `).all(guildId, userId) as Array<{ id: string }>;

  if (pendingApps.length === 0) return;

  logger.info({
    userId,
    guildId,
    pendingApps: pendingApps.length,
  }, "[guildMemberRemove] refreshing review cards for departed user");

  // Refresh each pending application's review card
  const { ensureReviewMessage } = await import("../features/review/card.js");
  for (const app of pendingApps) {
    try {
      await ensureReviewMessage(client, app.id);
    } catch (err) {
      logger.error({
        err,
        appId: app.id,
        userId,
        guildId,
      }, "[guildMemberRemove] failed to refresh review card");
    }
  }

  // Clean up per-user verify thread if the user had one open
  try {
    const { cleanupVerifyThreadForUser } = await import("../features/gate/threadGate.js");
    await cleanupVerifyThreadForUser(client, guildId, userId, "left_server");
  } catch (err) {
    logger.warn(
      { err, guildId, userId },
      "[guildMemberRemove] verify thread cleanup failed"
    );
  }
}));

// Safety cleanup: Remove from open_modmail table AND OPEN_MODMAIL_THREADS set if thread is deleted
// WHY: Prevents orphaned entries and stale in-memory state if a thread is deleted outside the normal close flow
// DOCS: https://discord.js.org/#/docs/discord.js/main/class/Client?scrollTo=e-threadDelete
client.on("threadDelete", wrapEvent("threadDelete", async (thread) => {
  if (!thread.guildId) return;

  // Remove from in-memory set (fast, always succeeds)
  const wasInSet = OPEN_MODMAIL_THREADS.delete(thread.id);

  // Remove from database guard table
  const result = db
    .prepare(
      `
    DELETE FROM open_modmail
    WHERE thread_id = ?
  `
    )
    .run(thread.id);

  if (result.changes > 0 || wasInSet) {
    logger.info(
      { threadId: thread.id, guildId: thread.guildId, dbDeleted: result.changes > 0, setRemoved: wasInSet },
      "[modmail] cleaned up orphaned modmail state on threadDelete"
    );
  }
}));

// ROLE AUTOMATION: Level rewards when Amaribot assigns level roles
// WHY: Automatically grant token/ticket rewards when users level up
// DOCS: https://discord.js.org/#/docs/discord.js/main/class/Client?scrollTo=e-guildMemberUpdate

client.on("guildMemberUpdate", wrapEvent("guildMemberUpdate", async (oldMember, newMember) => {
  // A partial oldMember carries no role list, so every role the member already holds
  // would read as newly added. The startup cache warm should make this unreachable;
  // if it fires, the previous role set is genuinely unknown and acting on it is worse
  // than skipping the event.
  if (oldMember.partial) {
    logger.warn({
      userId: newMember.id,
      guildId: newMember.guild.id,
    }, "[guildMemberUpdate] partial oldMember, skipping role diff");
    return;
  }

  // Server Artist role detection (handles both add and remove)
  await handleArtistRoleChange(oldMember, newMember);

  // NSFW Avatar monitoring: scan new server avatars
  // WHY: Detect NSFW avatars as soon as users change them
  // DOCS: See src/features/avatarNsfwMonitor.ts
  try {
    await handleAvatarChange(oldMember, newMember);
  } catch (err) {
    logger.error({
      err,
      userId: newMember.id,
      guildId: newMember.guild.id,
    }, "[guildMemberUpdate] Failed to scan avatar for NSFW");
  }

  // Detect newly added roles for level rewards + Patreon dedup
  const addedRoles = newMember.roles.cache.filter(
    (role) => !oldMember.roles.cache.has(role.id)
  );

  if (addedRoles.size === 0) return;

  // Inventory capture: queue catalogued reward roles for banking after a grace window,
  // so Mimu and Amari finish their own post-grant checks before the role disappears.
  try {
    const { handleItemRoleAdded } = await import("../features/inventory/capture.js");
    handleItemRoleAdded(oldMember, newMember);
  } catch (err) {
    logger.error({
      err,
      userId: newMember.id,
      guildId: newMember.guild.id,
    }, "[guildMemberUpdate] Failed to queue inventory capture");
  }

  // Patreon donor role dedup: if a donor role was just added, strip lower-tier stacks
  if (addedRoles.some((role) => isPatreonDonorRole(role.id))) {
    try {
      await handlePatreonRoleDedup(newMember);
    } catch (err) {
      logger.error({
        err,
        userId: newMember.id,
        guildId: newMember.guild.id,
      }, "[guildMemberUpdate] Failed to dedup Patreon donor roles");
    }

    // Grant art ticket rewards for the user's (now-deduped) Patreon tier
    try {
      const { handlePatreonArtRewards } = await import("../features/patreonArtRewards.js");
      await handlePatreonArtRewards(newMember);
    } catch (err) {
      logger.error({
        err,
        userId: newMember.id,
        guildId: newMember.guild.id,
      }, "[guildMemberUpdate] Failed to grant Patreon art rewards");
    }
  }

  // Check each new role to see if it's a level role
  // Process independently so one failure doesn't block others
  for (const [roleId] of addedRoles) {
    try {
      await handleLevelRoleAdded(newMember.guild, newMember, roleId);
    } catch (err) {
      logger.error({
        err,
        roleId,
        userId: newMember.id,
        guildId: newMember.guild.id,
      }, "[guildMemberUpdate] Failed to process level role reward");
      // Continue to next role
    }
  }
}));

// ROLE AUTOMATION: Event attendance tracking (movie nights + game nights)
// WHY: Track VC participation for event tier roles
// DOCS: https://discord.js.org/#/docs/discord.js/main/class/Client?scrollTo=e-voiceStateUpdate

client.on("voiceStateUpdate", wrapEvent("voiceStateUpdate", async (oldState, newState) => {
  const guildId = newState.guild?.id;
  if (!guildId) return;

  const userId = newState.member?.id;
  if (!userId) return;

  // Global voice session tracking (newsletter stats + insights)
  handleVoiceStateUpdate(oldState, newState);

  // Check for active movie event
  const movieEvent = getActiveMovieEvent(guildId);
  if (movieEvent) {
    // Track joins: user wasn't in event channel, now is (includes channel switches)
    const joined = oldState.channelId !== movieEvent.channelId && newState.channelId === movieEvent.channelId;
    // Track leaves: user was in event channel, now isn't (includes channel switches)
    const left = oldState.channelId === movieEvent.channelId && newState.channelId !== movieEvent.channelId;

    if (joined) {
      handleMovieVoiceJoin(guildId, userId);
    } else if (left) {
      handleMovieVoiceLeave(guildId, userId);
    }
  }

  // Check for active game event
  const gameEvent = getActiveGameEvent(guildId);
  if (gameEvent) {
    // Track joins: user wasn't in event channel, now is (includes channel switches)
    const joined = oldState.channelId !== gameEvent.channelId && newState.channelId === gameEvent.channelId;
    // Track leaves: user was in event channel, now isn't (includes channel switches)
    const left = oldState.channelId === gameEvent.channelId && newState.channelId !== gameEvent.channelId;

    if (joined) {
      handleGameVoiceJoin(guildId, userId);
    } else if (left) {
      handleGameVoiceLeave(guildId, userId);
    }
  }
}));

// Channel cache sync: keep channel_cache table up to date for web dashboard

client.on("channelCreate", wrapEvent("channelCreate", async (channel) => {
  if ("guild" in channel && channel.guild) syncChannel(channel);
}));

client.on("channelUpdate", wrapEvent("channelUpdate", async (_old, channel) => {
  if ("guild" in channel && channel.guild) syncChannel(channel);
}));

client.on("channelDelete", wrapEvent("channelDelete", async (channel) => {
  removeChannel(channel);
}));

// Role cache sync: keep role_cache table up to date for web dashboard

client.on("roleCreate", wrapEvent("roleCreate", async (role) => {
  syncRole(role);
}));

client.on("roleUpdate", wrapEvent("roleUpdate", async (_old, role) => {
  syncRole(role);
}));

client.on("roleDelete", wrapEvent("roleDelete", async (role) => {
  removeRole(role);
}));

// Ticket transcript capture — mirror messages in tickets channels + staff threads

client.on("messageCreate", wrapEvent("messageCreate.tickets", async (msg) => {
  captureMessage(msg);
}));

client.on("messageUpdate", wrapEvent("messageUpdate.tickets", async (_old, newMsg) => {
  captureMessage(newMsg);
}));

client.on("messageDelete", wrapEvent("messageDelete.tickets", async (msg) => {
  markMessageDeleted(msg);
}));

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE ARCHIVE — every message in guilds, full content + reactions
// See migrations/075_message_archive.ts + src/features/messageArchive.ts
// ─────────────────────────────────────────────────────────────────────────────

client.on("messageCreate", wrapEvent("messageCreate.archive", async (msg) => {
  if (!msg.guildId) return;
  archive.archiveMessage(msg, "live");
}));

client.on("messageUpdate", wrapEvent("messageUpdate.archive", async (_old, newMsg) => {
  if (!newMsg.guildId) return;
  // Fetch full message if partial (Discord may only deliver partial on edit)
  let full = newMsg;
  if (newMsg.partial) {
    try {
      full = await newMsg.fetch();
    } catch {
      return;
    }
  }
  archive.archiveMessage(full as import("discord.js").Message, "live");
}));

client.on("messageDelete", wrapEvent("messageDelete.archive", async (msg) => {
  if (!msg.guildId) return;
  archive.markMessageDeleted(msg);
}));

client.on("messageReactionAdd", wrapEvent("messageReactionAdd.archive", async (reaction, user) => {
  let r: import("discord.js").MessageReaction;
  if (reaction.partial) {
    try {
      r = await reaction.fetch();
    } catch {
      return;
    }
  } else {
    r = reaction;
  }
  if (!r.message.guildId) return;
  archive.recordReaction(r, user, "live");
}));

client.on("messageReactionRemove", wrapEvent("messageReactionRemove.archive", async (reaction, user) => {
  let r: import("discord.js").MessageReaction;
  if (reaction.partial) {
    try {
      r = await reaction.fetch();
    } catch {
      return;
    }
  } else {
    r = reaction;
  }
  if (!r.message.guildId) return;
  archive.removeReaction(r, user);
}));

// Invite tracking: detect which invite each new member used

client.on("inviteCreate", wrapEvent("inviteCreate", async (invite) => {
  handleInviteCreate(invite);
}));

client.on("inviteDelete", wrapEvent("inviteDelete", async (invite) => {
  handleInviteDelete(invite);
}));
}
