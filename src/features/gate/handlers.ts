/**
 * Pawtropolis Tech -- src/features/gate/handlers.ts
 * WHAT: Gate interaction handlers — Start button (DM or modal), modal-page
 *       submit (validate/persist/submit + queue scan), and Done button.
 * WHY: Extracted from gate.ts (#00011 step 3) to separate the interaction flow
 *       from panel management and persistence.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { type ButtonInteraction, type ModalSubmitInteraction, Client, MessageFlags } from "discord.js";
import { captureException, addBreadcrumb } from "../../lib/sentry.js";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { shortCode } from "../../lib/ids.js";
import { getConfig } from "../../lib/config.js";
import { ensureReviewMessage } from "../review.js";
import { type CmdCtx, ensureDeferred, replyOrEdit, withSql } from "../../lib/cmdWrap.js";
import { enrichEvent } from "../../lib/reqctx.js";
import { cacheUser } from "../../lib/userCache.js";
import { logActionPretty } from "../../logging/pretty.js";
import { notifyDashboard } from "../../web/notifyDashboard.js";
import { isPanicMode } from "../panicStore.js";
import { getQuestions, paginate, buildModalForPage, getOrCreateDraft, getDraft, upsertAnswer, submitApplication } from "./drafts.js";
import { parsePage, toAnswerMap, buildNavRow, buildFixRow, buildDoneRow } from "./ui.js";
import { queueAvatarScan } from "./scan.js";

export async function handleStartButton(interaction: ButtonInteraction) {
  try {
    if (!interaction.inGuild() || !interaction.guildId) {
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: "Guild only." });
      return;
    }

    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const requestedPage = parsePage(interaction.customId);

    // Page 0 (initial verify click): try DM flow, which falls back to modal on failure
    if (requestedPage === 0) {
      const { startDmVerification } = await import("./dmVerification.js");
      await startDmVerification(interaction, guildId, userId);
      return;
    }

    // Page navigation (Next/Back buttons from modal flow): show the modal directly
    if (isPanicMode(guildId)) {
      await interaction.reply({
        content: "Applications are temporarily paused. Please try again later.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const questions = getQuestions(guildId);
    const pages = paginate(questions);
    if (requestedPage >= pages.length) {
      await interaction.reply({
        content: "This page is out of date. Press Start to begin again.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const draft = getOrCreateDraft(db, guildId, userId);
    const draftData = getDraft(db, draft.application_id);
    const answersMap = draftData ? toAnswerMap(draftData.responses) : new Map<number, string>();
    const modal = buildModalForPage(pages[requestedPage], answersMap, draft.application_id);
    await interaction.showModal(modal);
  } catch (err) {
    captureException(err, {
      guildId: interaction.guildId ?? "unknown",
      userId: interaction.user.id,
      area: "handleStartButton",
    });
    if (!interaction.replied && !interaction.deferred) {
      await interaction
        .reply({ flags: MessageFlags.Ephemeral, content: "Something broke. Try again." })
        .catch(() => undefined);
    }
  }
}

export async function handleGateModalSubmit(
  interaction: ModalSubmitInteraction,
  ctx: CmdCtx,
  pageIndex: number
) {
  /**
   * handleGateModalSubmit
   * WHAT: Processes one modal page of answers; validates required fields; submits when last page.
   * WHY: Acknowledges within 3s (defer), then performs synchronous DB writes without blocking UX.
   * PARAMS:
   *  - interaction: ModalSubmitInteraction for the page.
   *  - ctx: Command context for logging/SQL trace.
   *  - pageIndex: Which page (0-based) we’re handling.
   * RETURNS: Promise<void> after replying ephemerally with next step/results.
   * LINKS:
   *  - Interaction timing: https://discord.com/developers/docs/interactions/receiving-and-responding
   */
  ctx.step("defer");
  await ensureDeferred(interaction);

  if (!interaction.inGuild() || !interaction.guildId) {
    ctx.step("validate_fail");
    await replyOrEdit(interaction, { content: "Guild only.", flags: MessageFlags.Ephemeral });
    return;
  }

  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  // Panic mode check - block all new submissions during emergencies
  // This prevents the review queue from being flooded while staff handles an incident
  ctx.step("panic_check");
  if (isPanicMode(guildId)) {
    logger.warn({
      evt: "gate_submission_blocked_panic",
      guildId,
      userId,
    }, "[gate] Submission blocked - panic mode active");

    await replyOrEdit(interaction, {
      content: "Applications are temporarily paused. Please try again later.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const appIdMatch = interaction.customId.match(/^v1:modal:([^:]+):p/);
  const appIdRaw = appIdMatch ? appIdMatch[1] : null;

  ctx.step("read_fields");

  const questions = getQuestions(guildId);
  if (questions.length === 0) {
    ctx.step("validate_fail");
    // handshake: defer → validate → write DB → render → reply (don’t break this order)
    // we use flags: MessageFlags.Ephemeral (v14 style), not ephemeral:true
    await replyOrEdit(interaction, {
      content: "No questions configured for this guild.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const pages = paginate(questions);
  const page = pages[pageIndex];
  if (!page) {
    ctx.step("validate_fail");
    await replyOrEdit(interaction, {
      content: "This page is out of date. Press Start to reload.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Resolve the draft row. "NEW" means handleStartButton deferred draft creation
  // to avoid DB writes before showModal() (which must complete within 3 seconds).
  // Now that we’re deferred, we can safely create the draft here.
  const draftByIdSql = `SELECT id, guild_id, user_id, status FROM application WHERE id = ?`;
  type DraftRow = { id: string; guild_id: string; user_id: string; status: string };
  let draftRow: DraftRow | undefined;

  if (appIdRaw === "NEW" || !appIdRaw) {
    ctx.step("create_draft");
    try {
      const draft = getOrCreateDraft(db, guildId, userId);
      draftRow = withSql(ctx, draftByIdSql, () => db.prepare(draftByIdSql).get(draft.application_id)) as
        | DraftRow
        | undefined;
    } catch (err) {
      if (err instanceof Error && err.message === "User is permanently rejected") {
        await replyOrEdit(interaction, {
          content: `You have been permanently rejected from this server.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (err instanceof Error && err.message === "Active application already submitted") {
        await replyOrEdit(interaction, {
          content: "You already have a submitted application.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      throw err;
    }
  } else {
    draftRow = withSql(ctx, draftByIdSql, () => db.prepare(draftByIdSql).get(appIdRaw)) as
      | DraftRow
      | undefined;
    if (draftRow && (draftRow.guild_id !== guildId || draftRow.user_id !== userId)) {
      draftRow = undefined;
    }
  }

  if (!draftRow) {
    ctx.step("validate_fail");
    await replyOrEdit(interaction, {
      content: "No active draft found. Press Start to begin again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (draftRow.status === "submitted") {
    ctx.step("already_submitted");
    await replyOrEdit(interaction, {
      content: "Application submitted. Review will happen in the staff channel.",
      components: buildDoneRow(),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (draftRow.status !== "draft") {
    ctx.step("validate_fail");
    await replyOrEdit(interaction, {
      content: "This application was already submitted or closed. Press Start to begin again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  ctx.step("validate_input");
  const answersOnPage = page.questions.map((question) => {
    const raw = interaction.fields.getTextInputValue(`v1:q:${question.q_index}`) ?? "";
    const value = raw.slice(0, 1000);
    return { question, value };
  });
  const missing = answersOnPage.filter(
    ({ question, value }) => question.required && value.trim().length === 0
  );
  if (missing.length > 0) {
    ctx.step("validate_fail");
    const list = missing.map(({ question }) => question.q_index + 1).join(", ");
    await replyOrEdit(interaction, {
      content: `Fill required question(s): ${list}.`,
      components: buildNavRow(pageIndex, pages.length),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  /*
   * Transaction wrapper here is critical. Without it, a crash mid-save could
   * leave the app in a weird partial state (some answers saved, some not).
   * Users would see "saved page 2" but only half their answers actually persisted.
   * Ask me how I know. (Actually don't, it was a bad week.)
   */
  ctx.step("persist_page");
  const save = db.transaction((rows: typeof answersOnPage) => {
    for (const row of rows) {
      upsertAnswer(db, draftRow!.id, row.question.q_index, row.value, ctx);
    }
  });
  save(answersOnPage);

  const hasNext = pageIndex < pages.length - 1;
  if (hasNext) {
    ctx.step("render_next_prompt");
    // Persist answers before rendering the next step; keep it ephemeral
    await replyOrEdit(interaction, {
      content: `Saved page ${pageIndex + 1}.`,
      components: buildNavRow(pageIndex, pages.length),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  ctx.step("validate_final");
  const draftData = getDraft(db, draftRow.id, ctx);
  const answerMap = draftData ? toAnswerMap(draftData.responses) : new Map<number, string>();
  const missingRequired = questions.filter((q) => q.required && !answerMap.get(q.q_index)?.trim());
  if (missingRequired.length > 0) {
    ctx.step("validate_fail");
    const list = missingRequired.map((q) => q.q_index + 1).join(", ");
    const firstMissing = missingRequired[0];
    const targetPage = pages.find((p) =>
      p.questions.some((q) => q.q_index === firstMissing.q_index)
    );
    const targetIndex = targetPage?.pageIndex ?? 0;
    await replyOrEdit(interaction, {
      content: `Required question(s) missing: ${list}.`,
      components: buildFixRow(targetIndex),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  addBreadcrumb({
    message: "Submitting gate application",
    category: "gate",
    data: { guildId, userId, appId: draftRow.id },
    level: "info",
  });

  ctx.step("db_begin");
  submitApplication(db, draftRow.id, ctx);
  cacheUser(interaction.user, guildId, interaction.member && "displayName" in interaction.member ? interaction.member : null);
  ctx.step("db_commit");

  // Track submission in wide event
  enrichEvent((e) => {
    e.setFeature("gate", "submit");
    e.addEntity({ type: "application", id: draftRow.id, code: shortCode(draftRow.id) });
  });

  ctx.step("post_commit");

  // Log application submission to action_log for analytics
  // NOTE: .catch() prevents logging failures from crashing the interaction
  // This is non-blocking - user experience is unchanged if logging fails
  if (interaction.guild) {
    await logActionPretty(interaction.guild, {
      appId: draftRow.id,
      appCode: shortCode(draftRow.id),
      actorId: interaction.user.id,
      subjectId: interaction.user.id,
      action: "app_submitted",
    }).catch((err) => {
      logger.warn({ err, appId: draftRow.id }, "[gate] failed to log app_submitted");
    });
  }

  const cfg = getConfig(guildId);
  if (cfg?.avatar_scan_enabled) {
    queueAvatarScan({
      appId: draftRow.id,
      user: interaction.user,
      cfg,
      client: interaction.client as Client,
      parentTraceId: ctx.traceId ?? null,
    });
  }

  // GOTCHA: This is NOT fire-and-forget - we await it.
  // We need the review card to exist before we tell the user "submitted"
  // because staff might see the card before this function returns.
  try {
    await ensureReviewMessage(interaction.client, draftRow.id);
  } catch (err) {
    logger.warn({ err, appId: draftRow.id }, "Failed to ensure review card after submission");
  }

  notifyDashboard("review:submitted", { appId: draftRow.id, applicantName: interaction.user.username });

  ctx.step("render_card");
  // final ack to the applicant — ephemeral to avoid channel noise
  await replyOrEdit(interaction, {
    content: "Application submitted. Review will happen in the staff channel.",
    components: buildDoneRow(),
    flags: MessageFlags.Ephemeral,
  });
}

// The simplest handler in this file. User clicks Done, we remove the buttons.
// The fallback to deferUpdate is for edge cases where update() fails
// (interaction expired, message deleted, etc). Silently eating the error
// is fine here - the user got their confirmation, we're just cleaning up.
export async function handleDoneButton(interaction: ButtonInteraction) {
  try {
    await interaction.update({ components: [] });
  } catch (err) {
    captureException(err, { area: "handleDoneButton" });
    if (!interaction.replied && !interaction.deferred) {
      await interaction.deferUpdate().catch(() => undefined);
    }
  }
}
