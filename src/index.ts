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
import { initializeSentry, captureException } from "./lib/sentry.js";
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

import { env } from "./lib/env.js";
import * as health from "./commands/health.js";
import * as cleanup from "./commands/cleanup.js";
import * as restoreroles from "./commands/restoreroles.js";
import * as gate from "./commands/gate.js";
import * as update from "./commands/update.js";
import * as config from "./commands/config.js";
import * as database from "./commands/database.js";
import { executeModmailCommand } from "./features/modmail.js";
import { wrapCommand } from "./lib/cmdWrap.js";
import { registerInteractionCreate } from "./events/interactionCreate.js";
import { registerMessageEvents } from "./events/messageCreate.js";
import { registerGuildEvents } from "./events/guildEvents.js";
import { registerReady } from "./startup/ready.js";

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

// Ready: schema heal, recovery, web + schedulers, presence, command sync.
// Extracted to src/startup/ready.ts (#00007); behavior preserved.
registerReady(client);


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
