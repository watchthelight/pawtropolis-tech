/**
 * Pawtropolis Tech — src/events/interactionCreate.ts
 * WHAT: Interaction router. Dedupes events then dispatches slash / button /
 *       modal / select / autocomplete / context-menu interactions to handlers.
 * WHY: Extracted from index.ts (#00007) so the ~1100-line routing gauntlet
 *      lives in one auditable place and the entrypoint stays a thin bootstrap.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  type Client,
  type Collection,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  MessageFlags,
} from "discord.js";
import { logger } from "../lib/logger.js";
import { isOwner } from "../lib/owner.js";
import { wrapEvent } from "../lib/eventWrap.js";
import { armWatchdog, ensureDeferred, wrapCommand } from "../lib/cmdWrap.js";
import { newTraceId, runWithCtx } from "../lib/reqctx.js";
import { postErrorCard } from "../lib/errorCard.js";
import { addBreadcrumb, setUser, captureException } from "../lib/sentry.js";
import {
  BTN_DECIDE_RE,
  BTN_MODMAIL_RE,
  BTN_PERM_REJECT_RE,
  BTN_COPY_UID_RE,
  BTN_VOTE_OUT_RE,
  BTN_PING_UNVERIFIED_RE,
  BTN_DBRECOVER_RE,
  BTN_AUDIT_RE,
  BTN_REPORT_RESOLVE_RE,
  identifyModalRoute,
} from "../lib/modalPatterns.js";
import { handleStartButton, handleGateModalSubmit, handleDoneButton } from "../features/gate.js";
import {
  handleReviewButton,
  handleRejectModal,
  handleAcceptModal,
  handleKickModal,
  handleUnclaimModal,
  handleModmailButton,
  handlePermRejectButton,
  handlePermRejectModal,
  handleCopyUidButton,
  handlePingInUnverified,
  handleDeletePing,
  handleVoteOutButton,
  handleVoteOutModal,
} from "../features/review.js";
import {
  handleModmailOpenButton,
  handleModmailCloseButton,
  handleModmailContextMenu,
} from "../features/modmail.js";
import { handleDbRecoveryButton } from "../features/dbRecoveryButtons.js";
import * as help from "../commands/help/index.js";
import * as listopen from "../commands/listopen.js";
import * as audit from "../commands/audit.js";
import * as isitreal from "../commands/isitreal.js";

// ─────────────────────────────────────────────────────────────────────────────
// INTERACTION DEDUPLICATION
// ─────────────────────────────────────────────────────────────────────────────
// Discord sometimes sends duplicate interaction events (observed: 4 duplicates within 19ms).
// Track recently processed interaction IDs to prevent double-processing.
// IDs expire after 10 seconds to prevent unbounded memory growth.
const recentInteractionIds = new Map<string, number>();
const INTERACTION_DEDUP_TTL_MS = 10_000;

// Cleanup old entries every 30 seconds
setInterval(() => {
  const now = Date.now();
  for (const [id, timestamp] of recentInteractionIds) {
    if (now - timestamp > INTERACTION_DEDUP_TTL_MS) {
      recentInteractionIds.delete(id);
    }
  }
}, 30_000).unref();

export function registerInteractionCreate(
  client: Client,
  commands: Collection<string, (interaction: ChatInputCommandInteraction) => Promise<void>>,
): void {
  client.on("interactionCreate", wrapEvent("interactionCreate", async (interaction) => {
    // Deduplicate: skip if we've already processed this interaction ID
    if (recentInteractionIds.has(interaction.id)) {
      logger.warn({
        evt: "interaction_duplicate",
        interactionId: interaction.id,
        userId: interaction.user.id,
        commandName: interaction.isChatInputCommand() ? interaction.commandName : null,
      }, "Duplicate interaction received - skipping");
      return;
    }
    recentInteractionIds.set(interaction.id, Date.now());

    // Global owner override: allow owners to bypass permission checks
    if (isOwner(interaction.user.id)) {
      logger.info(
        {
          evt: "owner_override",
          userId: interaction.user.id,
          kind: interaction.isChatInputCommand()
            ? "slash"
            : interaction.isButton()
              ? "button"
              : interaction.isModalSubmit()
                ? "modal"
                : interaction.isStringSelectMenu()
                  ? "select"
                  : "other",
          cmd: interaction.isChatInputCommand()
            ? interaction.commandName
            : ("customId" in interaction ? interaction.customId : "unknown"),
        },
        "Owner override activated - bypassing permission checks"
      );
    }

    // router map: slash -> button -> modal -> select -> autocomplete -> contextMenu; anything else early-return
    // WHY the ternary chain instead of a switch? TypeScript's type narrowing actually works
    // better this way - each branch preserves the interaction type for later checks.
    const kind = interaction.isChatInputCommand()
      ? "slash"
      : interaction.isButton()
        ? "button"
        : interaction.isModalSubmit()
          ? "modal"
          : interaction.isStringSelectMenu()
            ? "select"
            : interaction.isAutocomplete()
              ? "autocomplete"
              : interaction.isContextMenuCommand()
                ? "contextMenu"
                : "other";

    if (kind === "other") {
      return;
    }

    const traceId = newTraceId();
    const cmdId =
      kind === "slash" || kind === "autocomplete"
        ? interaction.isChatInputCommand() || interaction.isAutocomplete()
          ? interaction.commandName
          : "unknown"
        : interaction.isButton() || interaction.isModalSubmit() || interaction.isStringSelectMenu()
          ? interaction.customId
          : "unknown";

    await runWithCtx(
      {
        traceId,
        kind,
        cmd: cmdId,
        userId: interaction.user?.id,
        guildId: interaction.guildId ?? null,
        channelId: interaction.channelId ?? null,
      },
      async () => {
        setUser({
          id: interaction.user.id,
          username: interaction.user.username,
        });

        // Note: ix_enter log removed - now tracked by wide events in cmdWrap.ts

        if (kind === "modal" && interaction.isModalSubmit()) {
          const fields = Array.from(interaction.fields.fields.values()).map((field) => ({
            customId: field.customId,
            len:
              typeof (field as { value?: string }).value === "string"
                ? (field as { value?: string }).value!.length
                : 0,
          }));
          logger.info(
            {
              evt: "modal_fields",
              count: fields.length,
              fields,
              traceId,
            },
            "modal fields received"
          );
          if (process.env.VERBOSE_PAYLOADS === "1") {
            const verbose = Array.from(interaction.fields.fields.values()).map((field) => {
              const raw =
                typeof (field as { value?: string }).value === "string"
                  ? (field as { value?: string }).value!
                  : "";
              const truncated = raw.length > 300 ? `${raw.slice(0, 300)}...` : raw;
              return { customId: field.customId, value: truncated, len: raw.length };
            });
            logger.debug(
              {
                evt: "modal_field_values",
                fields: verbose,
                traceId,
              },
              "modal values"
            );
          }
          logger.info(
            {
              evt: "modal_summary",
              id: interaction.customId,
              count: fields.length,
              first: fields[0]?.customId,
              traceId,
            },
            "modal summary"
          );
        }

        // The watchdog barks (logs a warning) if we don't respond within Discord's 3-second SLA.
        // It doesn't actually cancel anything - just yells at you in the logs. Worth it.
        const cancelWatchdog = armWatchdog(interaction);

        try {
          // Autocomplete interactions - these have a different timeout (no 3s SLA) but still
          // need to be fast or Discord shows "no results found" to the user. Currently only
          // help uses this. If you add more, consider a command->handler map like slash commands.
          if (interaction.isAutocomplete()) {
            const { commandName } = interaction;
            if (commandName === "help") {
              await help.handleAutocomplete(interaction);
            }
            return;
          }

          if (interaction.isChatInputCommand()) {
            const executor = commands.get(interaction.commandName);
            if (!executor) {
              addBreadcrumb({
                message: `Unknown command attempted: ${interaction.commandName}`,
                category: "command",
                level: "warning",
                data: { commandName: interaction.commandName },
              });
              // respond fast or Discord returns 10062: Unknown interaction (3s SLA).
              // docs: https://discord.com/developers/docs/interactions/receiving-and-responding
              // We use MessageFlags.Ephemeral to avoid noisy public errors.
              // CommandInteraction: https://discord.js.org/#/docs/discord.js/main/class/CommandInteraction
              await interaction
                .reply({ content: "Unknown command.", flags: MessageFlags.Ephemeral })
                .catch((err) =>
                  logger.warn({ err, traceId }, "Failed to reply with unknown command message")
                );
              return;
            }

            addBreadcrumb({
              message: `Executing command: ${interaction.commandName}`,
              category: "command",
              level: "info",
              data: {
                commandName: interaction.commandName,
                guildId: interaction.guildId,
                userId: interaction.user.id,
              },
            });

            await executor(interaction);

            addBreadcrumb({
              message: `Command completed: ${interaction.commandName}`,
              category: "command",
              level: "info",
            });
            return;
          }

          if (interaction.isButton()) {
            const { customId } = interaction;

            /*
             * Button routing: the regex gauntlet begins.
             * Each button type has a customId format like "v1:action:code" or "action:hash:extra".
             * We match against regex patterns defined in lib/modalPatterns.js.
             * If your button isn't firing, check: (1) customId format, (2) regex escape issues,
             * (3) whether you're returning early before your handler. Ask me how I know.
             */

            // Check if this is a sample card button (non-functional preview)
            if (customId.includes("SAMPLE")) {
              await interaction.reply({
                content: "⚠️ This is a sample preview card. Buttons are non-functional.",
                flags: MessageFlags.Ephemeral,
              });
              return;
            }

            // Error card buttons (Ping bot dev / Copy trace / Run trace).
            // Attached to every "Command Failed" embed by lib/errorCardV2.ts.
            const errorCardMatch = (await import("../handlers/errorCardButtons.js")).matchErrorCardButton(customId);
            if (errorCardMatch) {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "button",
                  route: `errorcard_${errorCardMatch.action}`,
                  traceIdReferenced: errorCardMatch.traceId,
                  traceId,
                },
                "route: errorcard"
              );
              const { handleErrorCardButton } = await import("../handlers/errorCardButtons.js");
              await handleErrorCardButton(interaction, errorCardMatch.action, errorCardMatch.traceId);
              return;
            }

            // if this regex breaks, I cry
            const decideMatch = customId.match(BTN_DECIDE_RE);
            if (decideMatch) {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "button",
                  route: "review_decide",
                  action: decideMatch[1],
                  code: decideMatch[2],
                  traceId,
                },
                "route: review decide"
              );
              await handleReviewButton(interaction);
              return;
            }

            const modmailMatch = customId.match(BTN_MODMAIL_RE);
            if (modmailMatch) {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "button",
                  route: "review_modmail",
                  code: modmailMatch[1],
                  traceId,
                },
                "route: review modmail"
              );
              await handleModmailButton(interaction);
              return;
            }

            const permRejectMatch = customId.match(BTN_PERM_REJECT_RE);
            if (permRejectMatch) {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "button",
                  route: "review_perm_reject",
                  code: permRejectMatch[2],
                  traceId,
                },
                "route: permanent reject"
              );
              await handlePermRejectButton(interaction);
              return;
            }

            const copyUidMatch = customId.match(BTN_COPY_UID_RE);
            if (copyUidMatch) {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "button",
                  route: "review_copy_uid",
                  code: copyUidMatch[1],
                  userId: copyUidMatch[2],
                  traceId,
                },
                "route: copy UID"
              );
              await handleCopyUidButton(interaction);
              return;
            }

            const voteOutMatch = customId.match(BTN_VOTE_OUT_RE);
            if (voteOutMatch) {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "button",
                  route: "review_vote_out",
                  code: voteOutMatch[1],
                  traceId,
                },
                "route: vote out"
              );
              await handleVoteOutButton(interaction);
              return;
            }

            // Gate flow buttons - the v1: prefix is legacy but we're stuck with it now.
            // "done" finishes verification, "start" begins the multi-page questionnaire.
            if (customId === "v1:done") {
              await handleDoneButton(interaction);
              return;
            }
            if (customId.startsWith("v1:start")) {
              await handleStartButton(interaction);
              return;
            }

            // DM verification buttons (submit/cancel in DMs)
            if (customId.startsWith("v1:dm:")) {
              const { handleDmButton } = await import("../features/gate/dmVerification.js");
              await handleDmButton(interaction);
              return;
            }

            // Database recovery buttons
            const dbRecoverMatch = customId.match(BTN_DBRECOVER_RE);
            if (dbRecoverMatch) {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "button",
                  route: "db_recovery",
                  action: dbRecoverMatch[1],
                  candidateId: dbRecoverMatch[2],
                  traceId,
                },
                "route: database recovery"
              );
              await handleDbRecoveryButton(interaction);
              return;
            }

            // Audit buttons (confirm/cancel for bot audit)
            const auditMatch = customId.match(BTN_AUDIT_RE);
            if (auditMatch) {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "button",
                  route: "audit",
                  action: auditMatch[1],
                  traceId,
                },
                "route: audit"
              );
              await audit.handleAuditButton(interaction);
              return;
            }

            // QOTD suggestion review buttons (approve/reject)
            if (customId.startsWith("qotd:")) {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "button",
                  route: "qotd",
                  id: customId,
                  traceId,
                },
                "route: qotd button"
              );
              const { handleQotdButton } = await import("../features/qotd/handlers.js");
              await handleQotdButton(interaction);
              return;
            }

            // Listopen pagination buttons (with optional view mode: :all or :drafts)
            // That 8-char hex is a session ID to prevent button hijacking across users.
            // Yes, someone tried clicking someone else's pagination buttons. No, it didn't end well.
            if (customId.match(/^listopen:[a-f0-9]{8}:(prev|next):\d+(:(all|drafts))?$/)) {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "button",
                  route: "listopen_pagination",
                  id: customId,
                  traceId,
                },
                "route: listopen pagination"
              );
              await listopen.handleListOpenPagination(interaction);
              return;
            }

            // Modmail buttons
            if (customId.startsWith("v1:modmail:open:")) {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "button",
                  route: "modmail_open",
                  id: customId,
                  traceId,
                },
                "route: modmail open"
              );
              await handleModmailOpenButton(interaction);
              return;
            }
            if (customId.startsWith("v1:modmail:close:")) {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "button",
                  route: "modmail_close",
                  id: customId,
                  traceId,
                },
                "route: modmail close"
              );
              await handleModmailCloseButton(interaction);
              return;
            }
            if (customId.startsWith("v1:ping:delete:")) {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "button",
                  route: "ping_delete",
                  id: customId,
                  traceId,
                },
                "route: delete ping"
              );
              await handleDeletePing(interaction);
              return;
            }

            const pingMatch = customId.match(BTN_PING_UNVERIFIED_RE);
            if (pingMatch) {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "button",
                  route: "ping_unverified",
                  id: customId,
                  traceId,
                },
                "route: ping in unverified"
              );
              await handlePingInUnverified(interaction);
              return;
            }

            // AI detection service configuration buttons
            if (customId.startsWith("isitreal_")) {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "button",
                  route: "isitreal_config",
                  id: customId,
                  traceId,
                },
                "route: isitreal config"
              );
              const { isIsitRealInteraction, routeIsitRealInteraction } = await import("../commands/config/isitreal.js");
              if (isIsitRealInteraction(customId)) {
                await routeIsitRealInteraction(interaction);
              }
              return;
            }

            // AI detection API toggle buttons
            if (customId.startsWith("toggleapi_")) {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "button",
                  route: "toggleapi",
                  id: customId,
                  traceId,
                },
                "route: toggle api"
              );
              const { handleToggleApiButton } = await import("../commands/config/toggleapis.js");
              await handleToggleApiButton(interaction);
              return;
            }

            // First-party ticket system buttons (panel open / claim / close)
            if (customId.startsWith("tk:")) {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "button",
                  route: "tickets",
                  id: customId,
                  traceId,
                },
                "route: tickets"
              );
              const { handleTicketButton } = await import("../features/tickets/handlers.js");
              await handleTicketButton(interaction);
              return;
            }

            // Art reward redemption buttons
            if (customId.startsWith("redeemreward:")) {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "button",
                  route: "redeemreward",
                  id: customId,
                  traceId,
                },
                "route: redeem reward"
              );
              const { handleRedeemRewardButton } = await import("../features/artistRotation/index.js");
              await handleRedeemRewardButton(interaction);
              return;
            }

            // Byte token redemption buttons
            if (customId.startsWith("usebyte:")) {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "button",
                  route: "usebyte",
                  id: customId,
                  traceId,
                },
                "route: use byte token"
              );
              const { handleUseByteButton } = await import("../features/byteTokenHandler.js");
              await handleUseByteButton(interaction);
              return;
            }

            // Content report resolve button
            const reportResolveMatch = customId.match(BTN_REPORT_RESOLVE_RE);
            if (reportResolveMatch) {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "button",
                  route: "report_resolve",
                  code: reportResolveMatch[1],
                  traceId,
                },
                "route: report resolve"
              );
              const { handleReportResolveButton } = await import("../features/report/handlers.js");
              await handleReportResolveButton(interaction);
              return;
            }

            // Help navigation buttons - catch-all for the help system.
            // GOTCHA: This must come AFTER more specific help: patterns if we add any.
            if (customId.startsWith("help:")) {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "button",
                  route: "help_nav",
                  id: customId,
                  traceId,
                },
                "route: help navigation"
              );
              await help.handleHelpButton(interaction);
              return;
            }
            return;
          }

          // Select menu interactions - only two of these exist currently.
          // If you're adding a third, maybe consider a routing map?
          if (interaction.isStringSelectMenu()) {
            const { customId } = interaction;

            // Listopen drafts page select menu
            if (customId.match(/^listopen:[a-f0-9]{8}:page:drafts$/)) {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "select_menu",
                  route: "listopen_page_select",
                  id: customId,
                  traceId,
                },
                "route: listopen page select"
              );
              await listopen.handleListOpenPageSelect(interaction);
              return;
            }

            // Help command select menus
            if (customId.startsWith("help:select:")) {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "select_menu",
                  route: "help_select",
                  id: customId,
                  traceId,
                },
                "route: help select menu"
              );
              await help.handleHelpSelectMenu(interaction);
              return;
            }

            // Byte token selection menu
            if (customId.startsWith("usebyte:") && customId.includes(":select:")) {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "select_menu",
                  route: "usebyte_select",
                  id: customId,
                  traceId,
                },
                "route: use byte token select"
              );
              const { handleUseByteSelectMenu } = await import("../features/byteTokenHandler.js");
              await handleUseByteSelectMenu(interaction);
              return;
            }

            return;
          }

          if (interaction.isModalSubmit()) {
            const { customId } = interaction;

            // Modal routing is where things get spicy. Modals can come from buttons OR
            // from showModal() calls, so the customId has to encode enough state to know
            // what to do. The identifyModalRoute() helper parses these - don't roll your own.

            // First-party ticket close modal
            if (customId.startsWith("tk:closemod:")) {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "modal",
                  route: "ticket_close",
                  id: customId,
                  traceId,
                },
                "route: ticket close modal"
              );
              const { handleCloseModal } = await import("../features/tickets/handlers.js");
              await handleCloseModal(interaction);
              return;
            }

            // Help search modal
            if (customId === "help:modal:search") {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "modal",
                  route: "help_search",
                  id: customId,
                  traceId,
                },
                "route: help search modal"
              );
              await help.handleHelpModal(interaction);
              return;
            }

            // yes, HEX6 on purpose (humans > uuids)
            // The 6-char hex codes are used for application codes - short enough to read aloud
            // during debugging calls, long enough to be unique within a reasonable timeframe.
            if (customId.startsWith("v1:modal:") || customId.startsWith("v1:avatar:confirm18:")) {
              const route = identifyModalRoute(customId);

              if (route?.type === "gate_submit_page") {
                logger.info(
                  {
                    evt: "ix_route_match",
                    kind: "modal",
                    route: "gate_submit_page",
                    pageIndex: route.pageIndex,
                    id: customId,
                    traceId,
                  },
                  "route: modal page"
                );
                const executor = wrapCommand<ModalSubmitInteraction>(
                  "gate_submit_page",
                  async (commandCtx) => {
                    await handleGateModalSubmit(commandCtx.interaction, commandCtx, route.pageIndex);
                  }
                );
                await executor(interaction);
                return;
              }

              if (route?.type === "review_reject") {
                logger.info(
                  {
                    evt: "ix_route_match",
                    kind: "modal",
                    route: "review_reject",
                    id: customId,
                    code: route.code,
                    traceId,
                  },
                  "route: reject modal"
                );
                const executor = wrapCommand<ModalSubmitInteraction>(
                  "review_reject",
                  async (commandCtx) => {
                    await handleRejectModal(commandCtx.interaction);
                  }
                );
                await executor(interaction);
                return;
              }

              if (route?.type === "review_perm_reject") {
                logger.info(
                  {
                    evt: "ix_route_match",
                    kind: "modal",
                    route: "review_perm_reject",
                    id: customId,
                    code: route.code,
                    traceId,
                  },
                  "route: permanent reject modal"
                );
                const executor = wrapCommand<ModalSubmitInteraction>(
                  "review_perm_reject",
                  async (commandCtx) => {
                    await handlePermRejectModal(commandCtx.interaction);
                  }
                );
                await executor(interaction);
                return;
              }

              if (route?.type === "review_accept") {
                logger.info(
                  {
                    evt: "ix_route_match",
                    kind: "modal",
                    route: "review_accept",
                    id: customId,
                    code: route.code,
                    traceId,
                  },
                  "route: accept modal"
                );
                const executor = wrapCommand<ModalSubmitInteraction>(
                  "review_accept",
                  async (commandCtx) => {
                    await handleAcceptModal(commandCtx.interaction);
                  }
                );
                await executor(interaction);
                return;
              }

              if (route?.type === "review_kick") {
                logger.info(
                  {
                    evt: "ix_route_match",
                    kind: "modal",
                    route: "review_kick",
                    id: customId,
                    code: route.code,
                    traceId,
                  },
                  "route: kick modal"
                );
                const executor = wrapCommand<ModalSubmitInteraction>(
                  "review_kick",
                  async (commandCtx) => {
                    await handleKickModal(commandCtx.interaction);
                  }
                );
                await executor(interaction);
                return;
              }

              if (route?.type === "review_vote_out") {
                logger.info(
                  {
                    evt: "ix_route_match",
                    kind: "modal",
                    route: "review_vote_out",
                    id: customId,
                    code: route.code,
                    traceId,
                  },
                  "route: vote out modal"
                );
                const executor = wrapCommand<ModalSubmitInteraction>(
                  "review_vote_out",
                  async (commandCtx) => {
                    await handleVoteOutModal(commandCtx.interaction);
                  }
                );
                await executor(interaction);
                return;
              }

              if (route?.type === "review_unclaim") {
                logger.info(
                  {
                    evt: "ix_route_match",
                    kind: "modal",
                    route: "review_unclaim",
                    id: customId,
                    code: route.code,
                    traceId,
                  },
                  "route: unclaim modal"
                );
                const executor = wrapCommand<ModalSubmitInteraction>(
                  "review_unclaim",
                  async (commandCtx) => {
                    await handleUnclaimModal(commandCtx.interaction);
                  }
                );
                await executor(interaction);
                return;
              }

              if (route?.type === "report_resolve") {
                logger.info(
                  {
                    evt: "ix_route_match",
                    kind: "modal",
                    route: "report_resolve",
                    id: customId,
                    code: route.code,
                    traceId,
                  },
                  "route: report resolve modal"
                );
                const { handleReportResolveModal } = await import("../features/report/handlers.js");
                const executor = wrapCommand<ModalSubmitInteraction>(
                  "report_resolve",
                  async (commandCtx) => {
                    await handleReportResolveModal(commandCtx.interaction, route.code);
                  }
                );
                await executor(interaction);
                return;
              }

              if (route?.type === "qotd_suggest") {
                logger.info(
                  { evt: "ix_route_match", kind: "modal", route: "qotd_suggest", id: customId, traceId },
                  "route: qotd suggest modal"
                );
                const { handleQotdSuggestModal } = await import("../features/qotd/handlers.js");
                const executor = wrapCommand<ModalSubmitInteraction>(
                  "qotd_suggest",
                  async (commandCtx) => {
                    await handleQotdSuggestModal(commandCtx.interaction);
                  }
                );
                await executor(interaction);
                return;
              }

              if (route?.type === "qotd_reject") {
                logger.info(
                  { evt: "ix_route_match", kind: "modal", route: "qotd_reject", id: customId, code: route.code, traceId },
                  "route: qotd reject modal"
                );
                const { handleQotdRejectModal } = await import("../features/qotd/handlers.js");
                const executor = wrapCommand<ModalSubmitInteraction>(
                  "qotd_reject",
                  async (commandCtx) => {
                    await handleQotdRejectModal(commandCtx.interaction, route.code);
                  }
                );
                await executor(interaction);
                return;
              }

              // If we got here, someone submitted a modal we don't recognize.
              // This usually means a new modal was added but the route wasn't registered,
              // or there's a typo in the customId. Either way, the user sees an error card.
              logger.error(
                {
                  evt: "ix_route_miss",
                  kind: "modal",
                  id: customId,
                  traceId,
                },
                "unhandled modal customId pattern"
              );
              await postErrorCard(interaction, {
                cmd: "modal",
                phase: "route_miss",
                err: { name: "RouteError", message: `Unhandled modal: ${customId}` },
                lastSql: null,
                traceId,
              });
              return;
            }

            if (customId.startsWith("v1:gate:reset:")) {
              const { handleResetModal } = await import("../commands/gate.js");
              await handleResetModal(interaction);
              return;
            }

            // AI detection service configuration modals
            if (customId.startsWith("isitreal_modal_")) {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "modal",
                  route: "isitreal_config",
                  id: customId,
                  traceId,
                },
                "route: isitreal config modal"
              );
              const { routeIsitRealInteraction } = await import("../commands/config/isitreal.js");
              await routeIsitRealInteraction(interaction);
              return;
            }
          }

          // Context menu commands — USER targets
          if (kind === "contextMenu" && interaction.isUserContextMenuCommand()) {
            if (interaction.commandName === "Welcome Batch") {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "contextMenu",
                  route: "welcome_batch",
                  commandName: interaction.commandName,
                  traceId,
                },
                "route: welcome batch context menu"
              );
              const { handleWelcomeBatchContextMenu } = await import("../commands/welcomeBatchContext.js");
              await handleWelcomeBatchContextMenu(interaction);
              return;
            }
          }

          // Context menu commands — MESSAGE targets
          if (kind === "contextMenu" && interaction.isMessageContextMenuCommand()) {
            if (interaction.commandName === "Is It Real?") {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "contextMenu",
                  route: "isitreal",
                  commandName: interaction.commandName,
                  traceId,
                },
                "route: isitreal context menu"
              );
              await isitreal.handleIsItRealContextMenu(interaction);
              return;
            }

            if (interaction.commandName === "Modmail: Open") {
              logger.info(
                {
                  evt: "ix_route_match",
                  kind: "contextMenu",
                  route: "modmail",
                  commandName: interaction.commandName,
                  traceId,
                },
                "route: modmail context menu"
              );
              await handleModmailContextMenu(interaction);
              return;
            }
          }
        } catch (err) {
          // The catch-all safety net. If any handler throws and doesn't catch its own error,
          // we land here. The user gets an error card, Sentry gets notified, and the traceId
          // lets us correlate everything in the logs. Not elegant, but effective.
          const error = err instanceof Error ? err : new Error(String(err));
          logger.error(
            {
              evt: "ix_error",
              traceId,
              kind,
              cmd: cmdId,
              err: {
                name: error.name,
                code: (err as { code?: unknown })?.code,
                message: error.message,
                stack: error.stack,
              },
            },
            "interaction handler error"
          );
          captureException(error, {
            kind,
            cmd: cmdId,
            traceId,
          });
          try {
            // ensureDeferred prevents "interaction has already been acknowledged" errors
            // when we try to send the error card after a partial failure.
            await ensureDeferred(interaction as never);
            const { postErrorCard } = await import("../lib/errorCard.js");
            await postErrorCard(interaction as never, {
              traceId,
              cmd: cmdId,
              phase: "router",
              err: {
                name: error.name,
                code: (err as { code?: unknown })?.code,
                message: error.message,
                stack: error.stack,
              },
              lastSql: null,
            });
          } catch (cardErr) {
            logger.error(
              { err: cardErr, traceId, evt: "router_error_card_fail" },
              "failed to deliver router error card"
            );
          }
        } finally {
          cancelWatchdog();
          // Note: ix_ok log removed - now tracked by wide events in cmdWrap.ts
        }
      }
    );
  }));
}
