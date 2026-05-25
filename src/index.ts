/**
 * Pawtropolis Tech — src/index.ts
 * WHAT: Main process entrypoint. Boots the Discord client, routes interactions, and syncs commands.
 * WHY: Central orchestration so future-me can see startup and hot path routing in one place.
 * DISCLAIMER: if you're reading this at 2am, go to bed
 * FLOWS:
 *  - Ready: ensure schema → log identity → per‑guild command sync
 *  - Interaction: detect kind → run wrapped handler → error card on failure
 *  - Router: customId regexes for buttons/modals (HEX6 codes for humans)
 * DOCS:
 *  - discord.js v14 (interactions): https://discord.js.org/#/docs/discord.js/main/class/Interaction
 *  - Slash commands (Discord dev docs): https://discord.com/developers/docs/interactions/application-commands
 *  - Interaction replies (flags, ephemeral): https://discord.js.org/#/docs/discord.js/main/typedef/InteractionReplyOptions
 *  - REST Routes utility: https://discord.js.org/#/docs/rest/main/class/REST
 *  - Node ESM modules: https://nodejs.org/api/esm.html
 *  - better-sqlite3 API: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 *  - SQLite PRAGMA table_info: https://sqlite.org/pragma.html#pragma_table_info
 *  - Sentry Node SDK: https://docs.sentry.io/platforms/javascript/guides/node/
 *
 * NOTE: comments here are intentionally noisy. I like future-me to have breadcrumbs.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import {
  initializeSentry,
  addBreadcrumb,
  setTag,
  captureException,
} from "./lib/sentry.js";
import { UNCAUGHT_EXCEPTION_EXIT_DELAY_MS } from "./lib/constants.js";
initializeSentry();

import "dotenv/config";

import {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  Options,
  type ChatInputCommandInteraction,
  Events,
} from "discord.js";
import { logger } from "./lib/logger.js";

// ===== Global Error Handlers =====
// WHAT: Catch unhandled rejections and exceptions at process level
// WHY: Prevents silent crashes, ensures errors are logged and reported to Sentry
// DOCS: https://nodejs.org/api/process.html#event-uncaughtexception

process.on("unhandledRejection", (reason, promise) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  logger.error(
    { evt: "unhandled_rejection", err: error, promise },
    "[process] Unhandled promise rejection"
  );
  captureException(error, { context: "unhandledRejection" });
  // Don't exit - Discord.js can recover from most rejections
});

process.on("uncaughtException", (error, origin) => {
  logger.error(
    { evt: "uncaught_exception", err: error, origin },
    "[process] Uncaught exception - bot may be in unstable state"
  );
  captureException(error, { context: "uncaughtException", origin });
  // For uncaught exceptions, we should exit after logging
  // Give Sentry time to flush, then exit
  setTimeout(() => process.exit(1), UNCAUGHT_EXCEPTION_EXIT_DELAY_MS);
});

import { TRACE_INTERACTIONS, OWNER_IDS } from "./config.js";
import { env } from "./lib/env.js";
import * as health from "./commands/health.js";
import * as cleanup from "./commands/cleanup.js";
import * as restoreroles from "./commands/restoreroles.js";
import * as gate from "./commands/gate.js";
import * as update from "./commands/update.js";
import * as config from "./commands/config.js";
import * as database from "./commands/database.js";
import {
  executeModmailCommand,
  retrofitAllGuildsOnStartup,
  hydrateOpenModmailThreadsOnStartup,
} from "./features/modmail.js";
import { initializeBannerSync } from "./features/bannerSync.js";
import { wrapCommand } from "./lib/cmdWrap.js";
import { db } from "./db/db.js";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { syncCommandsToAllGuilds } from "./commands/sync.js";
import { registerInteractionCreate } from "./events/interactionCreate.js";
import { registerMessageEvents } from "./events/messageCreate.js";
import { registerGuildEvents } from "./events/guildEvents.js";

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates, // For movie night attendance + voice session tracking
    GatewayIntentBits.GuildPresences,   // For dashboard profile status display + online count
    GatewayIntentBits.GuildInvites,     // For invite usage tracking (growth source attribution)
    GatewayIntentBits.GuildMessageReactions, // Message archive reactor events
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User],
  // Cache limits to prevent unbounded memory growth in large servers
  // See: https://discordjs.guide/popular-topics/caching.html#limiting-cache-size
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    // Keep reasonable limits for commonly accessed data
    MessageManager: 200,        // Recent messages per channel
    GuildMemberManager: 500,    // Members per guild (we need members for role checks)
    UserManager: 500,           // Users across all guilds
    PresenceManager: 500,       // For dashboard profile status display
    VoiceStateManager: 200,     // For movie night tracking
    ReactionManager: 0,         // We don't use reactions
    ReactionUserManager: 0,     // We don't use reaction users
    GuildStickerManager: 0,     // We don't use stickers
    GuildScheduledEventManager: 0, // We don't use scheduled events
    StageInstanceManager: 0,    // We don't use stages
    ThreadMemberManager: 50,    // Minimal thread member caching
  }),
});

const commands = new Collection<
  string,
  (interaction: ChatInputCommandInteraction) => Promise<void>
>();
commands.set(health.data.name, wrapCommand("health", health.execute));
commands.set(cleanup.data.name, wrapCommand("cleanup", cleanup.execute));
commands.set(restoreroles.data.name, wrapCommand("restoreroles", restoreroles.execute));
commands.set(gate.data.name, wrapCommand("gate", gate.execute));
commands.set(gate.acceptData.name, wrapCommand("accept", gate.executeAccept));
commands.set(gate.rejectData.name, wrapCommand("reject", gate.executeReject));
commands.set(gate.kickData.name, wrapCommand("kick", gate.executeKick));
commands.set(gate.unclaimData.name, wrapCommand("unclaim", gate.executeUnclaim));
commands.set(gate.welcomeBatchData.name, wrapCommand("welcomebatch", gate.executeWelcomeBatch));
commands.set(update.data.name, wrapCommand("update", update.execute));
commands.set(config.data.name, wrapCommand("config", config.execute));
commands.set(database.data.name, wrapCommand("database", database.execute));
commands.set("modmail", wrapCommand("modmail", executeModmailCommand));

// Stats command (consolidated analytics)
import * as stats from "./commands/stats/index.js";
commands.set(stats.data.name, wrapCommand("stats", stats.execute));

// Send command (anonymous staff messages)
import * as send from "./commands/send.js";
commands.set(send.data.name, wrapCommand("send", send.execute));

// Resetdata command (metrics epoch reset)
import * as resetdata from "./commands/resetdata.js";
commands.set(resetdata.data.name, wrapCommand("resetdata", resetdata.execute));

// Flag command (manual user flagging)
import * as flag from "./commands/flag.js";
commands.set(flag.data.name, wrapCommand("flag", flag.execute));

// Audit command (bot account detection)
import * as audit from "./commands/audit.js";
commands.set(audit.data.name, wrapCommand("audit", audit.execute));

// AI detection command
import * as isitreal from "./commands/isitreal.js";
commands.set(isitreal.data.name, wrapCommand("isitreal", isitreal.execute));

// Unblock command (remove permanent rejection)
import * as unblock from "./commands/unblock.js";
commands.set(unblock.data.name, wrapCommand("unblock", unblock.execute));


// Backfill command (populate message_activity table)
import * as backfill from "./commands/backfill.js";
commands.set(backfill.data.name, wrapCommand("backfill", backfill.execute));

import * as sample from "./commands/sample.js";
commands.set(sample.data.name, wrapCommand("sample", sample.execute));

// Listopen command (moderator's claimed apps)
import * as listopen from "./commands/listopen.js";
commands.set(listopen.data.name, wrapCommand("listopen", listopen.execute));

// Purge command (bulk message deletion with password)
import * as purge from "./commands/purge.js";
commands.set(purge.data.name, wrapCommand("purge", purge.execute));


// Poke command (owner-only multi-channel ping)
import * as poke from "./commands/poke.js";
commands.set(poke.data.name, wrapCommand("poke", poke.execute));

// Forum post notification config commands (admin-only)
import * as setNotifyConfig from "./commands/review/setNotifyConfig.js";
import * as getNotifyConfig from "./commands/review/getNotifyConfig.js";
commands.set(setNotifyConfig.data.name, wrapCommand("review-set-notify-config", setNotifyConfig.execute));
commands.set(getNotifyConfig.data.name, wrapCommand("review-get-notify-config", getNotifyConfig.execute));

// Listopen output mode command (admin-only)
import * as reviewSetListopenOutput from "./commands/review-set-listopen-output.js";
commands.set(reviewSetListopenOutput.data.name, wrapCommand("review-set-listopen-output", reviewSetListopenOutput.execute));

// Role automation commands
import * as movie from "./commands/movie.js";
import * as roles from "./commands/roles.js";
import * as panic from "./commands/panic.js";
import * as event from "./commands/event/index.js";
commands.set(movie.data.name, wrapCommand("movie", movie.execute));
commands.set(roles.data.name, wrapCommand("roles", roles.execute));
commands.set(panic.data.name, wrapCommand("panic", panic.execute));
commands.set(event.data.name, wrapCommand("event", event.execute));

// Search command (user application history lookup)
import * as search from "./commands/search.js";
commands.set(search.data.name, wrapCommand("search", search.execute));


// Artist rotation commands
import * as artistqueue from "./commands/artistqueue.js";
import * as redeemreward from "./commands/redeemreward.js";
import * as art from "./commands/art.js";
commands.set(artistqueue.data.name, wrapCommand("artistqueue", artistqueue.execute));
commands.set(redeemreward.data.name, wrapCommand("redeemreward", redeemreward.execute));
commands.set(art.data.name, wrapCommand("art", art.execute));

// Help command (interactive help system)
import * as help from "./commands/help/index.js";
commands.set(help.data.name, wrapCommand("help", help.execute));

// Developer/debugging tools
import * as developer from "./commands/developer.js";
commands.set(developer.data.name, wrapCommand("developer", developer.execute));

// Test command (intentional error for logging verification)
import * as test from "./commands/test.js";
commands.set(test.data.name, wrapCommand("test", test.execute));

// Skull mode command (random skull reactions)
import * as skullmode from "./commands/skullmode.js";
commands.set(skullmode.data.name, wrapCommand("skullmode", skullmode.execute));

// Byte token self-service redemption
import * as usebyte from "./commands/usebyte.js";
commands.set(usebyte.data.name, wrapCommand("usebyte", usebyte.execute));

// Content report command (ambassador violation reports)
import * as report from "./commands/report.js";
commands.set(report.data.name, wrapCommand("report", report.execute));

// Event attendance stats and leaderboards
import * as attendance from "./commands/attendance.js";
commands.set(attendance.data.name, wrapCommand("attendance", attendance.execute));

// QOTD suggestion system
import * as qotd from "./commands/qotd.js";
commands.set(qotd.data.name, wrapCommand("qotd", qotd.execute));

// First responder / military verification
import * as verify from "./commands/verify.js";
commands.set(verify.data.name, wrapCommand("verify", verify.execute));

// Admin: one-shot migration to per-user verify threads
import * as adminMigrateUnverified from "./commands/admin-migrate-unverified.js";
commands.set(
  adminMigrateUnverified.data.name,
  wrapCommand("admin-migrate-unverified", adminMigrateUnverified.execute)
);

// First-party ticket system — panel posting (admin), close, manual reassign
import * as postticketpanel from "./commands/postticketpanel.js";
import * as closeticket from "./commands/closeticket.js";
import * as assignticket from "./commands/assignticket.js";
commands.set(
  postticketpanel.data.name,
  wrapCommand("postticketpanel", postticketpanel.execute)
);
commands.set(closeticket.data.name, wrapCommand("closeticket", closeticket.execute));
commands.set(assignticket.data.name, wrapCommand("assignticket", assignticket.execute));

// Staff-hoist experiment toggle
import * as testidea from "./commands/testidea.js";
commands.set(testidea.data.name, wrapCommand("testidea", testidea.execute));

// Drift guard: every name in runtimeManifest must have a registered handler,
// every registered handler must be in the manifest. Catches mistakes where a
// command is added to one place but not the other.
import { SLASH_COMMAND_NAMES } from "./commands/runtimeManifest.js";
{
  const missingHandlers = SLASH_COMMAND_NAMES.filter((n) => !commands.has(n));
  const orphanHandlers = Array.from(commands.keys()).filter(
    (n) => !(SLASH_COMMAND_NAMES as readonly string[]).includes(n),
  );
  if (missingHandlers.length > 0 || orphanHandlers.length > 0) {
    logger.error(
      {
        evt: "command_registration_drift",
        missingHandlers,
        orphanHandlers,
        manifestSize: SLASH_COMMAND_NAMES.length,
        runtimeSize: commands.size,
      },
      "[startup] command registration drift detected — runtime handlers and runtimeManifest disagree",
    );
    throw new Error(
      `Command registration drift: missing=${JSON.stringify(missingHandlers)} orphan=${JSON.stringify(orphanHandlers)}`,
    );
  }
}

client.once(Events.ClientReady, async () => {
  // schema self-heal before anything else
  // sudo make it work
  // Extracted to src/startup/schema.ts so the list of ensure* calls is
  // auditable in one place. Behavior preserved: errors logged at error
  // level via runStartupTask, startup continues regardless.
  const { runSchemaSelfHeal } = await import("./startup/schema.js");
  await runSchemaSelfHeal();

  // Load panic mode state from database (survives restarts now)
  try {
    const { loadPanicState } = await import("./features/panicStore.js");
    loadPanicState();
  } catch (err) {
    logger.error({ err }, "[startup] panic state load failed");
  }

  // Recover movie night sessions from database (crash recovery)
  try {
    const { recoverPersistedSessions, startSessionPersistence } =
      await import("./features/movieNight.js");
    const { events, sessions } = recoverPersistedSessions();
    if (events > 0) {
      logger.info({ events, sessions }, "[startup] Recovered movie night sessions");
    }
    startSessionPersistence();
  } catch (err) {
    logger.error({ err }, "[startup] Movie session recovery failed");
  }

  // Recover game night sessions from database (crash recovery)
  try {
    const { recoverPersistedGameSessions, startGameSessionPersistence } =
      await import("./features/events/gameNight.js");
    const { events, sessions } = recoverPersistedGameSessions();
    if (events > 0) {
      logger.info({ events, sessions }, "[startup] Recovered game night sessions");
    }
    startGameSessionPersistence();
  } catch (err) {
    logger.error({ err }, "[startup] Game session recovery failed");
  }

  // Seed voice session tracking for users currently in voice channels
  // WHAT: Closes stale open sessions from last run, opens new sessions for current VC users
  // WHY: Ensures continuous tracking across bot restarts — no time gaps in voice_session data
  try {
    const { seedCurrentVoiceSessions } = await import("./features/voiceSessionTracker.js");
    seedCurrentVoiceSessions(client);
  } catch (err) {
    logger.error({ err }, "[startup] Voice session seeding failed");
  }

  // Reconcile recovered event sessions against actual VC state
  // WHY: After recovery, sessions assume users are still in VC — verify against reality
  try {
    const { reconcileMovieVoiceSessions } = await import("./features/movieNight.js");
    for (const [, guild] of client.guilds.cache) {
      await reconcileMovieVoiceSessions(guild);
    }
  } catch (err) {
    logger.error({ err }, "[startup] Movie VC reconciliation failed");
  }

  try {
    const { reconcileGameVoiceSessions } = await import("./features/events/gameNight.js");
    for (const [, guild] of client.guilds.cache) {
      await reconcileGameVoiceSessions(guild);
    }
  } catch (err) {
    logger.error({ err }, "[startup] Game VC reconciliation failed");
  }

  // Sync channel names to channel_cache table for web dashboard
  try {
    const { syncAllChannels } = await import("./features/channelCacheSync.js");
    for (const [, guild] of client.guilds.cache) {
      syncAllChannels(guild);
    }
  } catch (err) {
    logger.error({ err }, "[startup] Channel cache sync failed");
  }

  // Sync role names to role_cache table for web dashboard (welcome editor)
  try {
    const { syncAllRoles } = await import("./features/roleCacheSync.js");
    for (const [, guild] of client.guilds.cache) {
      syncAllRoles(guild);
    }
  } catch (err) {
    logger.error({ err }, "[startup] Role cache sync failed");
  }

  // One-time sweep: strip stacked Patreon donor roles (retroactive fix)
  try {
    const { sweepPatreonRoleStacks } = await import("./features/patreonRoleDedup.js");
    await sweepPatreonRoleStacks(client);
  } catch (err) {
    logger.error({ err }, "[startup] Patreon role dedup sweep failed");
  }

  // Initialize invite tracking cache (growth source attribution)
  try {
    const { initInviteCache } = await import("./features/inviteTracker.js");
    await initInviteCache(client);
  } catch (err) {
    logger.error({ err }, "[startup] Invite cache init failed");
  }

  // Hydrate open modmail threads from database into memory
  // WHAT: Populates OPEN_MODMAIL_THREADS set from open_modmail table
  // WHY: Enables efficient O(1) lookups in messageCreate to route modmail messages
  // WHEN: Must run before message handlers start processing
  try {
    await hydrateOpenModmailThreadsOnStartup(client);
  } catch (err) {
    logger.error({ err }, "[startup] modmail thread hydration failed");
  }

  // Heal legacy parent overwrites so moderators can speak in older modmail threads
  // WHAT: Ensures parent channels grant SendMessagesInThreads to configured mod roles
  // WHY: Private threads require BOTH thread membership AND parent channel permissions
  // WHEN: Run once at startup to retrofit existing threads
  // DOCS: See retrofitAllGuildsOnStartup in src/features/modmail.ts
  try {
    await retrofitAllGuildsOnStartup(client);
  } catch (err) {
    logger.error({ err }, "[startup] modmail retrofit failed");
  }

  // Refresh review cards after bot identity change
  // WHAT: Re-posts all pending review cards so buttons work with the current bot application
  // WHY: Discord ties button interactions to the application that posted the message
  // WHEN: Only does work when there are review_card mappings pointing to old messages
  try {
    const { refreshAllPendingReviewCards } = await import("./features/review/card.js");
    const result = await refreshAllPendingReviewCards(client);
    if (result.refreshed > 0 || result.failed > 0) {
      logger.info(result, "[startup] review card refresh complete");
    }
  } catch (err) {
    logger.error({ err }, "[startup] review card refresh failed");
  }

  // Re-post gate entry panels after bot identity change
  // WHAT: For each guild, deletes any foreign-bot gate panels and posts/edits the current bot's
  // WHY: Pinned gate panels owned by the OLD bot have a Verify button Discord won't route to us;
  //      applicants would click and get nothing. Idempotent — no-ops if current bot already owns one.
  try {
    const { ensureGateEntryStartup } = await import("./features/gate.js");
    for (const [guildId] of client.guilds.cache) {
      try {
        const result = await ensureGateEntryStartup(client, guildId);
        if (result.deletedForeign > 0 || result.posted) {
          logger.info({ guildId, ...result }, "[startup] gate entry panel refreshed");
        }
      } catch (err) {
        logger.error({ err, guildId }, "[startup] gate entry refresh failed for guild");
      }
      // Pacing between guilds to avoid hammering the API
      await new Promise((r) => setTimeout(r, 250));
    }
  } catch (err) {
    logger.error({ err }, "[startup] gate entry startup hook failed");
  }

  // One-shot bulk migration of existing unverified members into per-user verify
  // threads. Gated by RUN_THREAD_MIGRATION=1 env var so it only runs when staff
  // explicitly opts in. Safe to leave the env var set across restarts (the
  // migration is idempotent via verify_thread PK), but conventional usage is
  // to set, restart, wait for completion, then unset.
  if (process.env.RUN_THREAD_MIGRATION === "1") {
    try {
      const { runThreadMigrationForUnverified } = await import("./features/gate/threadGate.js");
      // Run for the configured target guild only (or all guilds if no GUILD_ID set)
      const targetGuildId = process.env.GUILD_ID;
      for (const [, g] of client.guilds.cache) {
        if (targetGuildId && g.id !== targetGuildId) continue;
        try {
          const result = await runThreadMigrationForUnverified(g);
          logger.info({ guildId: g.id, ...result }, "[startup] thread migration result");
        } catch (err) {
          logger.error({ err, guildId: g.id }, "[startup] thread migration failed for guild");
        }
      }
    } catch (err) {
      logger.error({ err }, "[startup] thread migration startup hook failed");
    }
  }

  // Startup permission check: verify logging channel access
  // WHAT: Check if bot has permissions to post to configured logging channels
  // WHY: Warn early if logging will fail; allows admins to fix perms before actions occur
  // HOW: For each guild, resolve logging channel + validate SendMessages + EmbedLinks
  // DOCS: See getLoggingChannel in src/features/logger.ts
  try {
    const { getLoggingChannel } = await import("./features/logger.js");
    for (const [guildId, guild] of client.guilds.cache) {
      const channel = await getLoggingChannel(guild);
      if (!channel) {
        const { getLoggingChannelId } = await import("./config/loggingStore.js");
        const configuredChannelId = getLoggingChannelId(guildId);
        if (configuredChannelId) {
          logger.warn(
            { guildId, channelId: configuredChannelId },
            "[startup] logging channel configured but unavailable - check channel exists and bot has SendMessages + EmbedLinks permissions"
          );
        } else if (!process.env.LOGGING_CHANNEL) {
          logger.info(
            { guildId },
            "[startup] no logging channel configured - actions will be logged as JSON to console"
          );
        }
      } else {
        logger.info(
          { guildId, channelId: channel.id, channelName: channel.name },
          "[startup] logging channel verified"
        );
      }
    }
  } catch (err) {
    logger.error({ err }, "[startup] logging channel check failed");
  }

  // ===== Web Servers =====
  // Status endpoint + Dashboard API.
  // Extracted to src/startup/web.ts; behavior preserved.
  {
    const { startWebServers } = await import("./startup/web.js");
    await startWebServers(client);
  }

  // ===== Scheduler Initialization =====
  // Extracted to src/startup/schedulers.ts. Each scheduler is started
  // under runStartupTask with level=warn (optional, non-fatal).
  // The corresponding stopSchedulers() call lives in gracefulShutdown
  // so the start/stop pair is auditable in one file.
  {
    const { startSchedulers } = await import("./startup/schedulers.js");
    await startSchedulers(client);
  }

  // Initialize banner sync (bot profile + website)
  try {
    await initializeBannerSync(client);
  } catch (err) {
    logger.warn(
      { err },
      "[startup] banner sync failed to initialize - continuing without banner sync"
    );
  }

  // ===== Coordinated Graceful Shutdown =====
  // WHAT: Single handler for SIGTERM/SIGINT that shuts down all subsystems in order
  // WHY: Prevents data loss, ensures transcripts are flushed, stops schedulers cleanly
  // ORDER: 1) Log, 2) Stop schedulers, 3) Cleanup features, 4) Remove listeners, 5) Destroy client, 6) Close DB
  let isShuttingDown = false;

  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) {
      logger.warn({ signal }, "[shutdown] Already shutting down, ignoring");
      return;
    }
    isShuttingDown = true;

    logger.info({ signal }, "[shutdown] Graceful shutdown initiated");

    try {
      // 0. FIRST: Persist event sessions (most time-sensitive data)
      // WHY: PM2 kill_timeout may expire before we finish — save sessions before anything else
      try {
        const { persistAllSessions, stopSessionPersistence } =
          await import("./features/movieNight.js");
        persistAllSessions();
        stopSessionPersistence();
        logger.debug("[shutdown] Movie sessions persisted");
      } catch (err) {
        logger.warn({ err }, "[shutdown] Movie session persist failed (non-fatal)");
      }

      try {
        const { persistAllGameSessions, stopGameSessionPersistence } =
          await import("./features/events/gameNight.js");
        persistAllGameSessions();
        stopGameSessionPersistence();
        logger.debug("[shutdown] Game sessions persisted");
      } catch (err) {
        logger.warn({ err }, "[shutdown] Game session persist failed (non-fatal)");
      }

      // 0b. Stop web servers (extracted to src/startup/web.ts)
      try {
        const { stopWebServers } = await import("./startup/web.js");
        await stopWebServers();
        logger.debug("[shutdown] Web servers stopped");
      } catch (err) {
        logger.warn({ err }, "[shutdown] Web servers stop failed (non-fatal)");
      }

      // 1. Stop schedulers (extracted to src/startup/schedulers.ts)
      {
        const { stopSchedulers } = await import("./startup/schedulers.js");
        await stopSchedulers();
      }

      // 2. Flush message activity buffer before shutdown
      try {
        const { flushOnShutdown } = await import("./features/messageActivityLogger.js");
        flushOnShutdown();
        logger.debug("[shutdown] Message activity buffer flushed");
      } catch (err) {
        logger.warn({ err }, "[shutdown] Message activity flush failed (non-fatal)");
      }

      // 2b. Flush archive buffer (messages + reactions)
      try {
        const { flushArchiveBuffersOnShutdown } = await import("./features/messageArchive.js");
        flushArchiveBuffersOnShutdown();
        logger.debug("[shutdown] Archive buffer flushed");
      } catch (err) {
        logger.warn({ err }, "[shutdown] Archive flush failed (non-fatal)");
      }

      // 3. Cleanup banner sync listeners
      try {
        const { cleanupBannerSync } = await import("./features/bannerSync.js");
        cleanupBannerSync(client);
        logger.debug("[shutdown] Banner sync listeners cleaned up");
      } catch (err) {
        logger.warn({ err }, "[shutdown] Banner sync cleanup failed (non-fatal)");
      }

      // 4. Cleanup notify limiter (stops cleanup interval)
      try {
        const { notifyLimiter, InMemoryNotifyLimiter } = await import("./lib/notifyLimiter.js");
        if (notifyLimiter instanceof InMemoryNotifyLimiter) {
          notifyLimiter.destroy();
          logger.debug("[shutdown] Notify limiter cleanup interval stopped");
        }
      } catch (err) {
        logger.warn({ err }, "[shutdown] Notify limiter cleanup failed (non-fatal)");
      }

      // 5. Cleanup command-level intervals (flag cooldowns, modstats rate limiter)
      try {
        const { cleanupFlagCooldowns } = await import("./commands/flag.js");
        cleanupFlagCooldowns();
        logger.debug("[shutdown] Flag cooldowns cleanup complete");
      } catch (err) {
        logger.warn({ err }, "[shutdown] Flag cooldowns cleanup failed (non-fatal)");
      }

      try {
        const { cleanupStatsRateLimiter } = await import("./commands/stats/index.js");
        cleanupStatsRateLimiter();
        logger.debug("[shutdown] Stats rate limiter cleanup complete");
      } catch (err) {
        logger.warn({ err }, "[shutdown] Stats rate limiter cleanup failed (non-fatal)");
      }

      // 6. Close all open voice sessions
      try {
        const { closeAllOpenSessions } = await import("./features/voiceSessionTracker.js");
        closeAllOpenSessions();
        logger.debug("[shutdown] Voice sessions closed");
      } catch (err) {
        logger.warn({ err }, "[shutdown] Voice session close failed (non-fatal)");
      }

      // 7. Remove all event listeners before destroying client
      // WHY: Explicit cleanup prevents race conditions and makes shutdown behavior predictable
      client.removeAllListeners();
      logger.debug("[shutdown] Event listeners removed");

      // 8. Destroy Discord client (closes WebSocket connection)
      client.destroy();
      logger.debug("[shutdown] Discord client destroyed");

      // 9. Close database
      try {
        db.close();
        logger.debug("[shutdown] Database closed");
      } catch (err) {
        logger.warn({ err }, "[shutdown] Database close failed (non-fatal)");
      }

      logger.info("[shutdown] Graceful shutdown complete");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "[shutdown] Error during graceful shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  logger.info({ tag: client.user?.tag, id: client.user?.id }, "Bot ready");

  if (client.user) {
    setTag("bot_id", client.user.id);
    setTag("bot_username", client.user.username);
  }

  addBreadcrumb({
    message: "Bot successfully connected to Discord",
    category: "bot",
    level: "info",
  });

  // Restore saved bot status/presence from DB
  // WHAT: Load last status from /update status and apply it
  // WHY: Keeps status consistent across restarts
  // DOCS: See src/features/statusStore.ts
  try {
    const { getStatus } = await import("./features/statusStore.js");
    const saved = getStatus("global");
    if (saved && client.user) {
      const activities = [];

      // Add regular activity if present
      if (saved.activityType !== null && saved.activityText) {
        activities.push({ type: saved.activityType, name: saved.activityText });
      }

      // Add custom status if present (Custom type uses 'name' field)
      if (saved.customStatus) {
        activities.push({ type: 4, name: saved.customStatus }); // ActivityType.Custom = 4
      }

      if (activities.length > 0) {
        await client.user.setPresence({
          status: saved.status,
          activities,
        });
        logger.info(
          {
            activityType: saved.activityType,
            activityText: saved.activityText,
            customStatus: saved.customStatus,
            status: saved.status,
          },
          "[startup] bot presence restored from DB"
        );
      } else {
        logger.debug("[startup] no activities to restore, using default");
      }
    } else {
      logger.debug("[startup] no saved presence found, using default");
    }
  } catch (err) {
    logger.warn({ err }, "[startup] failed to restore bot presence - continuing with default");
  }

  logger.info({ ownerIds: OWNER_IDS }, "[startup] configured owners");
  logger.info({ enabled: TRACE_INTERACTIONS }, "[startup] interaction tracing");

  // speedrun% finding legacy SQL before prod does (only in dev, skip in prod/tests)
  // Skip in production to avoid runtime scanning overhead
  // Skip in tests to reduce noise
  const isVitest = !!process.env.VITEST_WORKER_ID;
  if (env.NODE_ENV !== "production" && !isVitest) {
    try {
      const bad: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.isFile() && full.endsWith(".js")) {
            const text = readFileSync(full, "utf8");
            const hasLegacy = /__old/.test(text) && !/legacyRe/.test(text);
            const hasRename = /RENAME\s+TO/i.test(text);
            if (hasLegacy || hasRename) bad.push(full);
          }
        }
      };
      const distRoot = join(process.cwd(), "dist");
      if (existsSync(distRoot)) {
        walk(distRoot);
        if (bad.length) {
          logger.warn(
            { evt: "dist_scan_legacy_sql", files: bad },
            "dist contains __old references"
          );
        }
      }
    } catch {
      // best-effort scan only
    }
  }

  const questionStats = db
    .prepare(
      `
    SELECT guild_id, COUNT(*) as count
    FROM guild_question
    GROUP BY guild_id
    ORDER BY count DESC
  `
    )
    .all() as Array<{ guild_id: string; count: number }>;

  if (questionStats.length > 0) {
    for (const stat of questionStats) {
      logger.info(
        {
          evt: "gate_startup_questions",
          guildId: stat.guild_id,
          count: stat.count,
        },
        `[gate] loaded questions: ${stat.count} for guild ${stat.guild_id}`
      );
    }
  } else {
    logger.warn(
      {
        evt: "gate_startup_no_questions",
      },
      "[gate] No questions found in any guild. Insert rows into guild_question to configure."
    );
  }

  if (env.NODE_ENV === "development") {
    logger.info("Dev mode: use `npm run deploy:cmds`.");
  } else {
    logger.info("Prod mode: `npm run deploy:cmds`");
  }

  // Startup hydration: sync commands to all current guilds for instant availability.
  // Per-guild sync is fast (<1m) vs global commands (up to 1h propagation delay).
  // Docs: https://discord.com/developers/docs/interactions/application-commands#bulk-overwrite-guild-application-commands
  const guildIds = Array.from(client.guilds.cache.keys());
  try {
    await syncCommandsToAllGuilds(guildIds);
  } catch (err) {
    logger.error({ err }, "[cmdsync] FAILED – see above; bot still starting");
  }

  // Re-enqueue any ticket attachments that were pending mirror at last shutdown.
  try {
    const { backfillPendingFromDb } = await import("./features/tickets/attachments.js");
    backfillPendingFromDb();
  } catch (err) {
    logger.warn({ err }, "[tickets] failed to backfill pending attachments at startup");
  }
});

// Guild / member / voice / channel / role / archive / invite event handlers.
// Extracted to src/events/guildEvents.ts (#00007); behavior preserved.
registerGuildEvents(client);



// Interaction router (slash/button/modal/select/autocomplete/contextMenu).
// Extracted to src/events/interactionCreate.ts (#00007); behavior preserved.
registerInteractionCreate(client, commands);

// Message + thread events (modmail/DM routing, dad/skull, forum post notify).
// Extracted to src/events/messageCreate.ts (#00007); behavior preserved.
registerMessageEvents(client);

async function main() {
  // Step 1: Database health check (fail fast if corrupted)
  // WHAT: Verifies database integrity before bot starts
  // WHY: Prevents running with corrupted data that could cause further issues
  // DOCS: See src/lib/dbHealthCheck.ts
  const { requireHealthyDatabase } = await import("./lib/dbHealthCheck.js");
  requireHealthyDatabase();

  // Step 2: Fail fast if critical env vars are missing
  // env from lib/env.js validates required vars at import time (fail-fast)
  const DISCORD_TOKEN = env.DISCORD_TOKEN;
  // CLIENT_ID is validated by env.ts schema (required, min length 1)
  if (!env.GUILD_ID) {
    logger.warn("[startup] GUILD_ID not set - commands will register globally");
  }

  // Step 3: Login to Discord
  await client.login(DISCORD_TOKEN);
}

// Only start the bot if not running in test environment
if (!process.env.VITEST_WORKER_ID) {
  main().catch((err) => {
    logger.error({ err }, "Fatal startup error");
    process.exit(1);
  });
}
