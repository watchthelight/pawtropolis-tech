/**
 * Pawtropolis Tech -- src/features/review/handlers/helpers.ts
 * WHAT: Helper functions and modal openers for review handlers.
 * WHY: Shared utilities extracted from handlers.ts for maintainability.
 * DOCS:
 *  - ButtonInteraction: https://discord.js.org/#/docs/discord.js/main/class/ButtonInteraction
 *  - ModalBuilder: https://discord.js.org/#/docs/discord.js/main/class/ModalBuilder
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ActionRowBuilder,
  ButtonInteraction,
  GuildMember,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { logger } from "../../../lib/logger.js";
import { shouldBypass, hasRole, ROLE_IDS } from "../../../lib/config.js";
import { replyOrEdit } from "../../../lib/cmdWrap.js";
import { shortCode } from "../../../lib/ids.js";
import { findAppByShortCode } from "../../appLookup.js";
import {
  BTN_DECIDE_RE,
  MODAL_REJECT_RE,
  MODAL_ACCEPT_RE,
} from "../../../lib/modalPatterns.js";

import type { ApplicationRow, ReviewStaffInteraction } from "../types.js";
import { getClaim, claimGuard } from "../claims.js";
import { loadApplication } from "../queries.js";

// ===== Constants =====

export const BUTTON_RE = BTN_DECIDE_RE;
export const MODAL_RE = MODAL_REJECT_RE;
export const ACCEPT_MODAL_RE = MODAL_ACCEPT_RE;

// ===== Helper Functions =====

/**
 * isStaff (now checks Gatekeeper role)
 * WHAT: Check if a member has Gatekeeper role or bypass permission.
 * WHY: Gate handler access to authorized Gatekeepers only.
 */
export function isStaff(member: GuildMember | null, userId: string): boolean {
  // Bot Owner / Server Dev bypass
  if (shouldBypass(userId, member)) return true;
  // Check for Gatekeeper role
  return hasRole(member, ROLE_IDS.GATEKEEPER);
}

/**
 * requireInteractionStaff
 * WHAT: Validates that an interaction is from a Gatekeeper in a guild.
 * WHY: Guards all handler entry points against unauthorized access.
 * RETURNS: true if valid, false if rejected (reply sent).
 */
export function requireInteractionStaff(interaction: ButtonInteraction | ModalSubmitInteraction): boolean {
  if (!interaction.inGuild() || !interaction.guildId) {
    interaction
      .reply({ flags: MessageFlags.Ephemeral, content: "Guild only." })
      .catch((err) => {
        logger.debug({ err, interactionId: interaction.id }, "[review] guild-only reply failed");
      });
    return false;
  }
  const member = interaction.member as GuildMember | null;
  const userId = interaction.user.id;
  if (!isStaff(member, userId)) {
    interaction
      .reply({ flags: MessageFlags.Ephemeral, content: "You do not have the Gatekeeper role required for this action." })
      .catch((err) => {
        logger.debug({ err, interactionId: interaction.id, guildId: interaction.guildId }, "[review] permission reply failed");
      });
    return false;
  }
  return true;
}

/**
 * resolveApplication
 * WHAT: Resolves an application from a short code, with validation.
 * WHY: Common pattern across all handlers - validates guild match and existence.
 * RETURNS: ApplicationRow or null if not found (reply sent).
 */
export async function resolveApplication(
  interaction: ReviewStaffInteraction,
  code: string
): Promise<ApplicationRow | null> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await replyOrEdit(interaction, { content: "Guild only." }).catch((err) => {
      logger.debug({ err, code, interactionId: interaction.id }, "[review] guild-only reply failed (resolveApplication)");
    });
    return null;
  }

  const row = findAppByShortCode(guildId, code) as { id: string } | null;
  if (!row) {
    await replyOrEdit(interaction, { content: `No application with code ${code}.` }).catch((err) => {
      logger.debug({ err, code, guildId, interactionId: interaction.id }, "[review] no-app reply failed");
    });
    return null;
  }

  const app = loadApplication(row.id);
  if (!app) {
    await replyOrEdit(interaction, { content: "Application not found." }).catch((err) => {
      logger.debug({ err, code, appId: row.id, interactionId: interaction.id }, "[review] app-not-found reply failed");
    });
    return null;
  }
  if (app.guild_id !== guildId) {
    await replyOrEdit(interaction, { content: "Guild mismatch for application." }).catch((err) => {
      logger.debug({ err, code, appId: app.id, guildId, interactionId: interaction.id }, "[review] guild-mismatch reply failed");
    });
    return null;
  }

  return app;
}

// ===== Modal Opening Functions =====

/**
 * safeShowModal
 * WHAT: Shows a modal with up-front state checks + structured failure logging.
 * WHY: showModal must be the FIRST response on an interaction (Discord rule)
 *      and the token only lives 3s. Calling it after an upstream ack or after
 *      the token aged out yields a confusing 10062 ("Unknown interaction").
 *      This helper makes both failure modes explicit instead of silently
 *      swallowing them.
 */
async function safeShowModal(
  interaction: ButtonInteraction,
  modal: ModalBuilder,
  ctx: { appId: string; action: string }
): Promise<boolean> {
  if (interaction.replied || interaction.deferred) {
    logger.warn(
      { ...ctx, replied: interaction.replied, deferred: interaction.deferred, interactionId: interaction.id },
      "[review] cannot show modal — interaction already acked upstream"
    );
    return false;
  }
  const ageMs = Date.now() - interaction.createdTimestamp;
  if (ageMs > 2500) {
    logger.warn({ ...ctx, ageMs, interactionId: interaction.id }, "[review] modal: interaction near token-expiry, skipping showModal");
    return false;
  }
  try {
    await interaction.showModal(modal);
    return true;
  } catch (err) {
    const code = (err as { code?: number })?.code;
    logger.warn(
      { ...ctx, err, code, ageMs: Date.now() - interaction.createdTimestamp, replied: interaction.replied, deferred: interaction.deferred, interactionId: interaction.id },
      "[review] showModal failed"
    );
    return false;
  }
}

/**
 * openRejectModal
 * WHAT: Shows the rejection modal with reason input.
 * WHY: Allows moderators to provide rejection reason before finalizing.
 */
export async function openRejectModal(interaction: ButtonInteraction, app: ApplicationRow) {
  const modal = new ModalBuilder()
    .setCustomId(`v1:modal:reject:code${shortCode(app.id)}`)
    .setTitle("Reject application");
  const reasonInput = new TextInputBuilder()
    .setCustomId("v1:modal:reject:reason")
    .setLabel("Reason (max 500 chars)")
    .setRequired(true)
    .setMaxLength(500)
    .setStyle(TextInputStyle.Paragraph);
  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput);
  modal.addComponents(row);

  if (app.status === "rejected" || app.status === "approved" || app.status === "kicked") {
    await replyOrEdit(interaction, { content: "This application is already resolved.", flags: MessageFlags.Ephemeral }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "reject" }, "[review] already-resolved reply failed");
    });
    return;
  }

  const claim = getClaim(app.id);
  const claimError = claimGuard(claim, interaction.user.id);
  if (claimError) {
    await replyOrEdit(interaction, { content: claimError, flags: MessageFlags.Ephemeral }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "reject" }, "[review] claim-guard reply failed");
    });
    return;
  }

  await safeShowModal(interaction, modal, { appId: app.id, action: "reject" });
}

/**
 * openAcceptModal
 * WHAT: Shows the accept modal with optional reason/comment field.
 * WHY: Acts as confirmation and allows funny/personal approval messages.
 */
export async function openAcceptModal(interaction: ButtonInteraction, app: ApplicationRow) {
  if (app.status === "rejected" || app.status === "approved" || app.status === "kicked") {
    await replyOrEdit(interaction, { content: "This application is already resolved.", flags: MessageFlags.Ephemeral }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "accept" }, "[review] already-resolved reply failed");
    });
    return;
  }

  const claim = getClaim(app.id);
  const claimError = claimGuard(claim, interaction.user.id);
  if (claimError) {
    await replyOrEdit(interaction, { content: claimError, flags: MessageFlags.Ephemeral }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "accept" }, "[review] claim-guard reply failed");
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`v1:modal:accept:code${shortCode(app.id)}`)
    .setTitle("Approve Application");
  const reasonInput = new TextInputBuilder()
    .setCustomId("v1:modal:accept:reason")
    .setLabel("Note/comment (optional, shown to user)")
    .setPlaceholder("Add a personal touch to the approval message...")
    .setRequired(false)
    .setMaxLength(500)
    .setStyle(TextInputStyle.Paragraph);
  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput);
  modal.addComponents(row);

  await safeShowModal(interaction, modal, { appId: app.id, action: "accept" });
}

/**
 * openPermRejectModal
 * WHAT: Shows the permanent rejection modal.
 * WHY: Requires detailed reason for permanent bans.
 */
export async function openPermRejectModal(interaction: ButtonInteraction, app: ApplicationRow) {
  const claim = getClaim(app.id);
  if (claim && claim.reviewer_id !== interaction.user.id) {
    await replyOrEdit(interaction, {
      content: "You did not claim this application.",
      flags: MessageFlags.Ephemeral,
    }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "perm_reject" }, "[review] not-claimed reply failed");
    });
    return;
  }

  const code = shortCode(app.id);
  const modal = new ModalBuilder()
    .setCustomId(`v1:modal:permreject:code${code}`)
    .setTitle("Permanently Reject");
  const input = new TextInputBuilder()
    .setCustomId("v1:modal:permreject:reason")
    .setLabel("Rejection reason")
    .setPlaceholder("Provide a detailed reason for permanent rejection...")
    .setRequired(true)
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(500);
  const modalRow = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  modal.addComponents(modalRow);

  await safeShowModal(interaction, modal, { appId: app.id, action: "perm_reject" });
}

/**
 * openKickModal
 * WHAT: Shows the kick confirmation modal with optional reason field.
 * WHY: Prevents accidental kicks by requiring explicit confirmation.
 */
export async function openKickModal(interaction: ButtonInteraction, app: ApplicationRow) {
  if (app.status === "rejected" || app.status === "approved" || app.status === "kicked") {
    await replyOrEdit(interaction, { content: "This application is already resolved.", flags: MessageFlags.Ephemeral }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "kick" }, "[review] already-resolved reply failed");
    });
    return;
  }

  const claim = getClaim(app.id);
  const claimError = claimGuard(claim, interaction.user.id);
  if (claimError) {
    await replyOrEdit(interaction, { content: claimError, flags: MessageFlags.Ephemeral }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "kick" }, "[review] claim-guard reply failed");
    });
    return;
  }

  const code = shortCode(app.id);
  const modal = new ModalBuilder()
    .setCustomId(`v1:modal:kick:code${code}`)
    .setTitle("Confirm Kick");
  const reasonInput = new TextInputBuilder()
    .setCustomId("v1:modal:kick:reason")
    .setLabel("Reason (optional)")
    .setPlaceholder("Why are you kicking this user?")
    .setRequired(false)
    .setMaxLength(500)
    .setStyle(TextInputStyle.Paragraph);
  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput);
  modal.addComponents(row);

  await safeShowModal(interaction, modal, { appId: app.id, action: "kick" });
}

/**
 * openVoteOutModal
 * WHAT: Shows the vote-out reason modal.
 * WHY: Each vote requires a short justification so consensus rejections
 *      leave a per-voter rationale, not just a count.
 */
export async function openVoteOutModal(interaction: ButtonInteraction, app: ApplicationRow) {
  if (app.status === "rejected" || app.status === "approved" || app.status === "kicked") {
    await replyOrEdit(interaction, { content: "This application is already resolved.", flags: MessageFlags.Ephemeral }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "vote_out" }, "[review] already-resolved reply failed");
    });
    return;
  }

  const code = shortCode(app.id);
  const modal = new ModalBuilder()
    .setCustomId(`v1:modal:vote_out:code${code}`)
    .setTitle("Vote Out — Reason");
  const reasonInput = new TextInputBuilder()
    .setCustomId("v1:modal:vote_out:reason")
    .setLabel("Reason (max 300 chars)")
    .setPlaceholder("Why are you voting to reject this applicant?")
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(300)
    .setStyle(TextInputStyle.Paragraph);
  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput);
  modal.addComponents(row);

  await safeShowModal(interaction, modal, { appId: app.id, action: "vote_out" });
}

/**
 * openUnclaimModal
 * WHAT: Shows the unclaim confirmation modal.
 * WHY: Prevents accidental unclaims by requiring explicit confirmation.
 */
export async function openUnclaimModal(interaction: ButtonInteraction, app: ApplicationRow) {
  if (app.status === "rejected" || app.status === "approved" || app.status === "kicked") {
    await replyOrEdit(interaction, { content: "This application is already resolved.", flags: MessageFlags.Ephemeral }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "unclaim" }, "[review] already-resolved reply failed");
    });
    return;
  }

  const claim = getClaim(app.id);
  if (!claim) {
    await replyOrEdit(interaction, { content: "This application is not currently claimed.", flags: MessageFlags.Ephemeral }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "unclaim" }, "[review] not-claimed reply failed");
    });
    return;
  }

  if (claim.reviewer_id !== interaction.user.id) {
    await replyOrEdit(interaction, { content: "You did not claim this application. Only the claim owner can unclaim it.", flags: MessageFlags.Ephemeral }).catch((err) => {
      logger.debug({ err, appId: app.id, action: "unclaim" }, "[review] not-owner reply failed");
    });
    return;
  }

  const code = shortCode(app.id);
  const modal = new ModalBuilder()
    .setCustomId(`v1:modal:unclaim:code${code}`)
    .setTitle("Confirm Unclaim");
  const confirmInput = new TextInputBuilder()
    .setCustomId("v1:modal:unclaim:confirm")
    .setLabel("Type UNCLAIM to confirm")
    .setPlaceholder("UNCLAIM")
    .setRequired(true)
    .setMinLength(7)
    .setMaxLength(7)
    .setStyle(TextInputStyle.Short);
  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(confirmInput);
  modal.addComponents(row);

  await safeShowModal(interaction, modal, { appId: app.id, action: "unclaim" });
}
