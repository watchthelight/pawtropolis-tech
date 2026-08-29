// SPDX-License-Identifier: LicenseRef-ANW-1.0

// This file aggregates all slash command definitions for bulk registration with Discord.
// The buildCommands() function returns JSON payloads that get PUT to Discord's API.
//
// GOTCHA: Discord caches slash commands aggressively. After adding/removing commands here,
// you need to re-register them. Global commands can take up to 1 hour to propagate.
// Guild commands update instantly - prefer guild-scoped commands during development.
//
// Each import pulls in a SlashCommandBuilder instance. We call .toJSON() to serialize
// them into the format Discord's REST API expects.

/*
 * WHY so many imports? Discord.js forces each command to be its own export.
 * We could dynamically scan the commands folder, but explicit imports mean
 * the bundler can tree-shake and we get compile-time errors if a command breaks.
 * The verbose pain here saves debugging pain later.
 */
import { data as gateData, acceptData, rejectData, kickData, unclaimData, welcomeBatchData } from "./gate.js";
import { data as healthData } from "./health.js";
import { data as updateData } from "./update.js";
import { data as configData } from "./config.js";
import { data as databaseData } from "./database.js";
// This one lives in features/ because modmail is both a command AND a feature module.
// Not ideal, but refactoring it would be a three-hour yak shave.
import { modmailCommand, modmailContextMenu } from "../features/modmail.js";
import { isitRealContextMenu } from "./isitreal.js";
import { welcomeBatchContextMenu } from "./welcomeBatchContext.js";
import { data as statsData } from "./stats/index.js";
import { data as eventData } from "./event/index.js";
import { data as sendData } from "./send.js";
import { data as resetdataData } from "./resetdata.js";
import { data as purgeData } from "./purge.js";
import { data as cleanupData } from "./cleanup.js";
import { data as flagData } from "./flag.js";
import { data as sampleData } from "./sample.js";
import { data as listopenData } from "./listopen.js";
import { data as setNotifyConfigData } from "./review/setNotifyConfig.js";
import { data as getNotifyConfigData } from "./review/getNotifyConfig.js";
import { data as pokeData } from "./poke.js";
import { data as unblockData } from "./unblock.js";
import { data as backfillData } from "./backfill.js";
import { data as reviewSetListopenOutputData } from "./review-set-listopen-output.js";
import { data as movieData } from "./movie.js";
import { data as rolesData } from "./roles.js";
// Yes, there's a panic button. No, you don't want to find out what it does the hard way.
import { data as panicData } from "./panic.js";
import { data as searchData } from "./search.js";
import { data as artistqueueData } from "./artistqueue.js";
import { data as redeemrewardData } from "./redeemreward.js";
import { data as usebyteData } from "./usebyte.js";
import { data as stashData } from "./stash.js";
import { data as redeemData } from "./redeem.js";
import { data as artData } from "./art.js";
import { data as auditData } from "./audit.js";
import { data as isitrealData } from "./isitreal.js";
import { data as helpData } from "./help/index.js";
import { data as developerData } from "./developer.js";
import { data as testData } from "./test.js";
import { data as skullmodeData } from "./skullmode.js";
import { data as reportData } from "./report.js";
import { data as attendanceData } from "./attendance.js";
import { data as qotdData } from "./qotd.js";
import { data as verifyData } from "./verify.js";
import { data as adminMigrateUnverifiedData } from "./admin-migrate-unverified.js";
import { data as postticketpanelData } from "./postticketpanel.js";
import { data as closeticketData } from "./closeticket.js";
import { data as assignticketData } from "./assignticket.js";
import { data as restorerolesData } from "./restoreroles.js";
import { data as testideaData } from "./testidea.js";

// Returns an array of command JSON objects for Discord's bulk command registration.
// Discord has a limit of 100 slash commands per bot per guild, so we're fine here.
// If you hit that limit, consider using subcommands to consolidate related commands.
//
// GOTCHA: Adding a command here does nothing until you run `npm run deploy:cmds`.
// Forgetting this step is a rite of passage. You will do it at least once.
export function buildCommands() {
  return [
    // Gate workflow commands - these are the core moderation actions
    gateData.toJSON(),
    acceptData.toJSON(),
    rejectData.toJSON(),
    kickData.toJSON(),
    unclaimData.toJSON(),
    welcomeBatchData.toJSON(),

    // System/admin commands
    healthData.toJSON(),
    updateData.toJSON(),
    configData.toJSON(),
    databaseData.toJSON(),

    // Feature commands
    modmailCommand.toJSON(),
    statsData.toJSON(),
    eventData.toJSON(),
    sendData.toJSON(),
    resetdataData.toJSON(),
    purgeData.toJSON(),
    cleanupData.toJSON(),
    flagData.toJSON(),
    sampleData.toJSON(),
    listopenData.toJSON(),
    setNotifyConfigData.toJSON(),
    getNotifyConfigData.toJSON(),
    pokeData.toJSON(),
    unblockData.toJSON(),
    backfillData.toJSON(),
    reviewSetListopenOutputData.toJSON(),
    movieData.toJSON(),
    rolesData.toJSON(),
    panicData.toJSON(),
    searchData.toJSON(),

    // Artist rotation commands - the art queue feature nobody asked for but everyone uses
    artistqueueData.toJSON(),
    redeemrewardData.toJSON(),
    artData.toJSON(),

    // Byte token redemption - self-service XP multipliers
    usebyteData.toJSON(),
    stashData.toJSON(),
    redeemData.toJSON(),

    // Admin utilities
    auditData.toJSON(),
    isitrealData.toJSON(),

    // Help system
    helpData.toJSON(),

    // Developer/debugging tools
    developerData.toJSON(),
    testData.toJSON(),
    skullmodeData.toJSON(),

    // Content report system - ambassador violation reports
    reportData.toJSON(),

    // Event attendance stats and leaderboards
    attendanceData.toJSON(),

    // QOTD suggestion system
    qotdData.toJSON(),

    // First responder / military verification
    verifyData.toJSON(),

    // Admin: one-shot migration to per-user verify threads
    adminMigrateUnverifiedData.toJSON(),

    // First-party ticket system — panel posting, close, manual reassign
    postticketpanelData.toJSON(),
    closeticketData.toJSON(),
    assignticketData.toJSON(),

    // Role recovery — re-grant roles to returning members
    restorerolesData.toJSON(),

    // Staff-hoist experiment toggle
    testideaData.toJSON(),

    /*
     * Context menu commands are registered alongside slash commands in Discord.js v14.
     * These show up when you right-click a user or message. Up to 15 of each type allowed.
     */
    isitRealContextMenu.toJSON(),
    modmailContextMenu.toJSON(),
    welcomeBatchContextMenu.toJSON(),
  ];
}
