/**
 * Pawtropolis Tech -- src/features/review/handlers/claimHandlers.ts
 * WHAT: Claim and unclaim handlers for review applications.
 * WHY: Manages claim lifecycle for preventing concurrent review conflicts.
 * DOCS:
 *  - Claim system: src/features/review/claims.ts
 *  - Atomic operations: src/features/reviewActions.ts
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ButtonInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { db } from "../../../db/db.js";
import { logger } from "../../../lib/logger.js";
import { captureException } from "../../../lib/sentry.js";
import { ephemeralFollowUp } from "../../../lib/cmdWrap.js";
import { shortCode } from "../../../lib/ids.js";
import { logActionPretty } from "../../../logging/pretty.js";

import type { ApplicationRow } from "../types.js";
import { ensureReviewMessage } from "../../review.js";
import { cacheUser } from "../../../lib/userCache.js";
import { notifyDashboard } from "../../../web/notifyDashboard.js";

// ===== Claim Handlers =====

/**
 * handleClaimToggle
 * WHAT: Handles claim button using atomic claimTx().
 * WHY: Prevents race conditions when two mods click "Claim" simultaneously.
 */
export async function handleClaimToggle(interaction: ButtonInteraction, app: ApplicationRow) {
  // Import atomic claim function
  const { claimTx, ClaimError: ClaimTxError } = await import("../../reviewActions.js");

  // Note: deferUpdate() already called by parent handleReviewButton, so don't call again

  // Attempt atomic claim (includes validation and transaction)
  try {
    claimTx(app.id, interaction.user.id, app.guild_id);
  } catch (err) {
    if (err instanceof ClaimTxError) {
      let msg = "Failed to claim application";
      if (err.code === "ALREADY_CLAIMED") {
        msg = "This application is already claimed by another moderator.";
      } else if (err.code === "INVALID_STATUS") {
        msg = `Cannot claim: application is already **${err.message.split(" ")[2]}**.`;

        // Refresh card to show current state
        try {
          await ensureReviewMessage(interaction.client, app.id);
        } catch (refreshErr) {
          logger.warn({ err: refreshErr, appId: app.id }, "[review] failed to refresh card after blocked claim");
        }
      } else if (err.code === "APP_NOT_FOUND") {
        msg = "Application not found.";
      }

      await ephemeralFollowUp(interaction, msg);

      return;
    }

    // Unexpected error
    logger.error({ err, appId: app.id }, "[review] unexpected claim error");
    await ephemeralFollowUp(interaction, "An unexpected error occurred. Please try again.");
    return;
  }

  // Check if user is permanently rejected (additional validation)
  const permRejectCheck = db
    .prepare(
      `SELECT permanently_rejected FROM application WHERE guild_id = ? AND user_id = ? AND permanently_rejected = 1`
    )
    .get(app.guild_id, app.user_id) as { permanently_rejected: number } | undefined;

  if (permRejectCheck) {
    await ephemeralFollowUp(
      interaction,
      `This user has been permanently rejected from **${interaction.guild?.name ?? "this server"}** and cannot reapply.`
    );
    logger.info(
      { userId: app.user_id, guildId: app.guild_id, moderatorId: interaction.user.id },
      "[review] Claim attempt blocked - user permanently rejected"
    );
    return;
  }

  // Note: review_action INSERT is now inside claimTx() for atomicity

  logger.info(
    {
      appId: app.id,
      claimerId: interaction.user.id,
      guildId: app.guild_id,
    },
    "[review] application claimed successfully"
  );

  // Cache moderator identity for dashboard display
  if (interaction.guild) {
    const member = interaction.member && "displayAvatarURL" in interaction.member ? interaction.member as import("discord.js").GuildMember : null;
    cacheUser(interaction.user, app.guild_id, member);
  }

  // Log claim action via pretty embed
  if (interaction.guild) {
    await logActionPretty(interaction.guild, {
      appId: app.id,
      appCode: shortCode(app.id),
      actorId: interaction.user.id,
      subjectId: app.user_id,
      action: "claim",
    }).catch((err) => {
      logger.warn({ err, appId: app.id }, "[review] failed to log claim action");
    });
  }

  // Refresh the review card to show the claim
  try {
    await ensureReviewMessage(interaction.client, app.id);
    logger.info({ appId: app.id }, "[review] card refreshed after claim");
  } catch (err) {
    logger.warn({ err, appId: app.id }, "[review] failed to refresh review card after claim");
    captureException(err, { area: "claim:ensureReviewMessage", appId: app.id });
  }

  notifyDashboard("review:claimed", { appId: app.id, reviewerId: interaction.user.id });

  // The card itself already reflects the claim (ensureReviewMessage above).
  // Confirm privately to the clicking mod instead of editReply-ing the shared
  // card content (which would replace the rendered embed + buttons).
  await ephemeralFollowUp(interaction, "You have claimed this application.");
}

/**
 * handleUnclaimAction
 * WHAT: Handles unclaim button using atomic unclaimTx().
 * WHY: Releases claim so other moderators can review.
 */
export async function handleUnclaimAction(interaction: ButtonInteraction | ModalSubmitInteraction, app: ApplicationRow) {
  // Import atomic unclaim function
  const { unclaimTx, ClaimError: ClaimTxError } = await import("../../reviewActions.js");

  // Note: deferUpdate() already called by parent handleReviewButton, so don't call again

  // Attempt atomic unclaim (includes validation and transaction)
  try {
    unclaimTx(app.id, interaction.user.id, app.guild_id);
  } catch (err) {
    if (err instanceof ClaimTxError) {
      let msg = "Failed to unclaim application";
      if (err.code === "NOT_CLAIMED") {
        msg = "This application is not currently claimed.";
      } else if (err.code === "NOT_OWNER") {
        msg = "You did not claim this application. Only the claim owner can unclaim it.";
      } else if (err.code === "APP_NOT_FOUND") {
        msg = "Application not found.";
      }

      await ephemeralFollowUp(interaction, msg);

      return;
    }

    // Unexpected error
    logger.error({ err, appId: app.id }, "[review] unexpected unclaim error");
    await ephemeralFollowUp(interaction, "An unexpected error occurred. Please try again.");
    return;
  }

  // NOTE: unclaimTx already inserts into review_action table inside its transaction,
  // so we don't need to insert again here. The audit trail is complete from unclaimTx.

  logger.info(
    {
      appId: app.id,
      moderatorId: interaction.user.id,
      guildId: app.guild_id,
    },
    "[review] application unclaimed successfully"
  );

  // Cache moderator identity for dashboard display
  if (interaction.guild) {
    const member = interaction.member && "displayAvatarURL" in interaction.member ? interaction.member as import("discord.js").GuildMember : null;
    cacheUser(interaction.user, app.guild_id, member);
  }

  // Log unclaim action via pretty embed
  if (interaction.guild) {
    await logActionPretty(interaction.guild, {
      appId: app.id,
      appCode: shortCode(app.id),
      actorId: interaction.user.id,
      subjectId: app.user_id,
      action: "unclaim",
      meta: { type: "unclaim" },
    }).catch((err) => {
      logger.warn({ err, appId: app.id }, "[review] failed to log unclaim action");
    });
  }

  // Refresh the review card to show unclaimed state
  try {
    await ensureReviewMessage(interaction.client, app.id);
    logger.info({ appId: app.id }, "[review] card refreshed after unclaim");
  } catch (err) {
    logger.warn({ err, appId: app.id }, "[review] failed to refresh review card after unclaim");
    captureException(err, { area: "unclaim:ensureReviewMessage", appId: app.id });
  }

  notifyDashboard("review:unclaimed", { appId: app.id, reviewerId: interaction.user.id });

  // Send single ephemeral feedback to confirm unclaim (no public message)
  await ephemeralFollowUp(interaction, `Application \`${shortCode(app.id)}\` unclaimed successfully.`);
}
