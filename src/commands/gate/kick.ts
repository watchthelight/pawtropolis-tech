/**
 * Pawtropolis Tech -- src/commands/gate/kick.ts
 * WHAT: /kick command for kicking applicants.
 * WHY: Staff kicks applicants by short code, user mention, or user ID with a reason.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  requireGatekeeper,
  findAppByShortCode,
  findPendingAppByUserId,
  ensureReviewMessage,
  updateReviewActionMeta,
  getClaim,
  claimGuard,
  kickTx,
  kickFlow,
  type CommandContext,
  ensureDeferred,
  replyOrEdit,
  withStep,
  withSql,
  logger,
  type ApplicationRow,
} from "./shared.js";
import { MAX_REASON_LENGTH } from "../../lib/constants.js";

export const kickData = new SlashCommandBuilder()
  .setName("kick")
  .setDescription("Kick an applicant by short code, user mention, or user ID")
  .addStringOption((option) =>
    option.setName("reason").setDescription("Reason for kick").setRequired(true)
  )
  .addStringOption((option) =>
    option.setName("app").setDescription("Application short code (e.g., A1B2C3)").setRequired(false)
  )
  .addUserOption((option) =>
    option.setName("user").setDescription("User to kick (@mention or select)").setRequired(false)
  )
  .addStringOption((option) =>
    option.setName("uid").setDescription("Discord User ID (if user not in server)").setRequired(false)
  )
  .setDMPermission(false);

export async function executeKick(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeKick
   * WHAT: Staff kicks a user by short code with a reason (records review_action and attempts DM + kick).
   * PITFALLS: Role/permission hierarchy may block kicks (50013); we fail-soft and log.
   */
  const { interaction } = ctx;
  if (!interaction.guildId || !interaction.guild) {
    await replyOrEdit(interaction, { content: "Guild only." });
    return;
  }
  if (!requireGatekeeper(
    interaction,
    "kick",
    "Kicks an applicant from the server with a reason."
  )) return;

  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const codeRaw = interaction.options.getString("app", false);
  const userOption = interaction.options.getUser("user", false);
  const uidRaw = interaction.options.getString("uid", false);
  const reason = interaction.options.getString("reason", true).trim();

  // Security: Validate reason length to prevent database bloat and potential DoS
  if (reason.length > MAX_REASON_LENGTH) {
    await replyOrEdit(interaction, {
      content: `Reason too long (max ${MAX_REASON_LENGTH} characters, you provided ${reason.length}).`,
    });
    return;
  }

  // Count how many identifier options were provided
  const providedCount = [codeRaw, userOption, uidRaw].filter(Boolean).length;
  if (providedCount === 0) {
    await replyOrEdit(interaction, {
      content: "Please provide one of: `app` (short code), `user` (@mention), or `uid` (user ID).",
    });
    return;
  }
  if (providedCount > 1) {
    await replyOrEdit(interaction, {
      content: "Please provide only one option: `app`, `user`, or `uid`.",
    });
    return;
  }

  const lookupResult = await withStep(ctx, "lookup_app", async () => {
    let app: ApplicationRow | null = null;
    if (codeRaw) {
      const code = codeRaw.trim().toUpperCase();
      app = withSql(ctx, "SELECT application by short_code", () =>
        findAppByShortCode(interaction.guildId!, code)
      );
      if (!app) {
        return { found: false as const, error: `No application with code ${code}.` };
      }
    } else if (userOption) {
      app = withSql(ctx, "SELECT application by user_id", () =>
        findPendingAppByUserId(interaction.guildId!, userOption.id)
      );
      if (!app) {
        return { found: false as const, error: `No pending application found for ${userOption}.` };
      }
    } else if (uidRaw) {
      const uid = uidRaw.trim();
      if (!/^[0-9]{5,20}$/.test(uid)) {
        return { found: false as const, error: "Invalid user ID. Must be 5-20 digits." };
      }
      app = withSql(ctx, "SELECT application by user_id", () =>
        findPendingAppByUserId(interaction.guildId!, uid)
      );
      if (!app) {
        return { found: false as const, error: `No pending application found for user ID ${uid}.` };
      }
    }
    if (!app) {
      return { found: false as const, error: "Could not find application." };
    }
    return { found: true as const, app };
  });

  if (!lookupResult.found) {
    await replyOrEdit(interaction, { content: lookupResult.error });
    return;
  }
  const app = lookupResult.app;

  const claimResult = await withStep(ctx, "claim_check", async () => {
    const claim = withSql(ctx, "SELECT review_claim", () => getClaim(app.id));
    const claimError = claimGuard(claim, interaction.user.id);
    return { claimError };
  });

  if (claimResult.claimError) {
    await replyOrEdit(interaction, { content: claimResult.claimError });
    return;
  }

  const tx = await withStep(ctx, "kick_tx", async () => {
    return withSql(ctx, "UPDATE application status=kicked", () =>
      kickTx(app.id, interaction.user.id, reason.length > 0 ? reason : null)
    );
  });

  if (tx.kind === "already") {
    await replyOrEdit(interaction, { content: "Already kicked." });
    return;
  }
  if (tx.kind === "terminal") {
    await replyOrEdit(interaction, { content: `Already resolved (${tx.status}).` });
    return;
  }
  if (tx.kind === "invalid") {
    await replyOrEdit(interaction, { content: "Application not in a kickable state." });
    return;
  }

  const flow = await withStep(ctx, "kick_flow", async () => {
    const result = await kickFlow(interaction.guild!, app.user_id, reason.length > 0 ? reason : null);
    withSql(ctx, "UPDATE review_action meta", () =>
      updateReviewActionMeta(tx.reviewActionId, result)
    );
    return result;
  });

  // Note: Claim preserved for review card display

  await withStep(ctx, "refresh_review", async () => {
    try {
      await ensureReviewMessage(interaction.client, app.id);
    } catch (err) {
      logger.warn({ err, appId: app.id }, "Failed to refresh review card after /kick");
    }
  });

  await withStep(ctx, "reply", async () => {
    // Build user-friendly response based on kick result
    let message: string;
    if (flow.kickSucceeded) {
      message = flow.dmDelivered
        ? "Member kicked and notified via DM."
        : "Member kicked (DM delivery failed, user may have DMs disabled).";
    } else if (flow.error) {
      // Provide specific error context to staff
      message = `Kick failed: ${flow.error}`;
    } else {
      message = "Kick attempted; check logs for details.";
    }
    await replyOrEdit(interaction, { content: message });
  });
}
