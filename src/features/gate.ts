/**
 * Pawtropolis Tech — src/features/gate.ts
 * WHAT: Gate entry UX (Start button + modal pages), draft persistence, submission, and optional avatar scan queueing.
 * WHY: Keeps applicant-facing interactions and staff review linkage in one module.
 * FLOWS:
 *  - Start button: find/create draft → open modal for requested page
 *  - Modal submit: defer → validate → persist answers → maybe submit → refresh review card → reply
 *  - Submission: enqueue avatar scan (non-blocking) → notify user
 * DOCS:
 *  - CommandInteractions: https://discord.js.org/#/docs/discord.js/main/class/CommandInteraction
 *  - Interaction response rules: https://discord.com/developers/docs/interactions/receiving-and-responding
 *  - Interaction reply options/flags: https://discord.js.org/#/docs/discord.js/main/typedef/InteractionReplyOptions
 *  - better-sqlite3 API: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
 *  - SQLite UPSERT: https://sqlite.org/lang_UPSERT.html
 *
 * NOTE: Ephemeral replies keep channels clean; we only post public content where intentional.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
import {
  ButtonInteraction,
  Client,
  MessageFlags,
  ModalSubmitInteraction,
  PermissionsBitField,
  type GuildTextBasedChannel,
  type Message,
} from "discord.js";
import { captureException, addBreadcrumb } from "../lib/sentry.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { shortCode } from "../lib/ids.js";
import { getConfig } from "../lib/config.js";
import { ensureReviewMessage } from "./review.js";
import type { CmdCtx } from "../lib/cmdWrap.js";
import { ensureDeferred, replyOrEdit, withSql } from "../lib/cmdWrap.js";
import { enrichEvent } from "../lib/reqctx.js";
import { cacheUser } from "../lib/userCache.js";
import { logActionPretty } from "../logging/pretty.js";
import { notifyDashboard } from "../web/notifyDashboard.js";
import { isPanicMode } from "./panicStore.js";
import { buildGateEntryPayload, findExistingGateEntry } from "./gate/entryPanel.js";
import { parsePage, toAnswerMap, buildNavRow, buildFixRow, buildDoneRow } from "./gate/ui.js";
import { queueAvatarScan } from "./gate/scan.js";
export * from "./gate/drafts.js";
import { getQuestions, paginate, buildModalForPage, getOrCreateDraft, getDraft, upsertAnswer, submitApplication } from "./gate/drafts.js";
export { BRAND_COLOR } from "./gate/constants.js";
export { buildGateEntryPayload, queueAvatarScan };
export { ensureGateEntryStartup, refreshGateEntry } from "./gate/entryPanel.js";


export type EnsureGateEntryResult = {
  created: boolean;
  edited: boolean;
  pinned: boolean;
  channelId?: string;
  messageId?: string;
  reason?: string;
};

function logPhase(ctx: CmdCtx, phase: string, extras: Record<string, unknown> = {}) {
  logger.info({
    evt: "gate_entry_step",
    traceId: ctx.traceId,
    phase,
    ...extras,
  });
}

function markSkippedPhase(ctx: CmdCtx, phase: string, extras: Record<string, unknown> = {}) {
  ctx.step(phase);
  logPhase(ctx, phase, { skipped: true, ...extras });
}

/**
 * ensureGateEntry
 * WHAT: Ensures there is a pinned Gate Entry message with a Start button in the configured gate channel.
 * WHY: Applicants need a stable entry point; we refresh/edit/pin instead of duplicating.
 * PARAMS:
 *  - ctx: CommandContext for logging/tracing.
 *  - guildId: Target guild id.
 * RETURNS: EnsureGateEntryResult describing what happened (created/edited/pinned).
 * THROWS: Propagates errors; callers typically log and continue.
 * LINKS:
 *  - Guild text channels API: https://discord.js.org/#/docs/discord.js/main/class/GuildTextBasedChannel
 * PITFALLS:
 *  - Requires SendMessages/ManageMessages to pin; fail-soft when missing permissions.
 */
export async function ensureGateEntry(
  ctx: CmdCtx,
  guildId: string
): Promise<EnsureGateEntryResult> {
  const result: EnsureGateEntryResult = { created: false, edited: false, pinned: false };

  ctx.step("load_config");
  const cfg = getConfig(guildId);
  logPhase(ctx, "load_config", { guildId, hasGateChannel: Boolean(cfg?.gate_channel_id) });
  if (!cfg?.gate_channel_id) {
    markSkippedPhase(ctx, "open_channel", { guildId, reason: "gate channel not configured" });
    markSkippedPhase(ctx, "find_existing", { reason: "gate channel not configured" });
    markSkippedPhase(ctx, "send_or_edit", { reason: "gate channel not configured" });
    markSkippedPhase(ctx, "maybe_pin", { reason: "gate channel not configured" });
    result.reason = "gate channel not configured";
    return result;
  }

  let channel: GuildTextBasedChannel | null = null;
  ctx.step("open_channel");
  try {
    const fetched = await ctx.interaction.client.channels.fetch(cfg.gate_channel_id);
    if (fetched && fetched.isTextBased() && !fetched.isDMBased()) {
      channel = fetched as GuildTextBasedChannel;
    }
  } catch (err) {
    logPhase(ctx, "open_channel", {
      guildId,
      channelId: cfg.gate_channel_id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (!channel) {
    logPhase(ctx, "open_channel", {
      guildId,
      channelId: cfg.gate_channel_id,
      reason: "channel unavailable",
    });
    markSkippedPhase(ctx, "find_existing", { reason: "channel unavailable" });
    markSkippedPhase(ctx, "send_or_edit", { reason: "channel unavailable" });
    markSkippedPhase(ctx, "maybe_pin", { reason: "channel unavailable" });
    result.reason = "gate channel unavailable";
    return result;
  }

  result.channelId = channel.id;

  const botId = ctx.interaction.client.user?.id ?? null;
  const me =
    channel.guild.members.me ??
    (botId ? await channel.guild.members.fetch(botId).catch(() => null) : null);
  if (!me) {
    logPhase(ctx, "open_channel", {
      guildId,
      channelId: channel.id,
      reason: "bot member missing",
    });
    markSkippedPhase(ctx, "find_existing", { reason: "bot member missing" });
    markSkippedPhase(ctx, "send_or_edit", { reason: "bot member missing" });
    markSkippedPhase(ctx, "maybe_pin", { reason: "bot member missing" });
    result.reason = "bot member missing";
    return result;
  }

  const perms = channel.permissionsFor(me);
  if (!perms) {
    logPhase(ctx, "open_channel", {
      guildId,
      channelId: channel.id,
      reason: "permissions unavailable",
    });
    markSkippedPhase(ctx, "find_existing", { reason: "permissions unavailable" });
    markSkippedPhase(ctx, "send_or_edit", { reason: "permissions unavailable" });
    markSkippedPhase(ctx, "maybe_pin", { reason: "permissions unavailable" });
    result.reason = "unable to resolve permissions";
    return result;
  }

  const hasView = perms.has(PermissionsBitField.Flags.ViewChannel);
  const hasSend = perms.has(PermissionsBitField.Flags.SendMessages);
  const hasManage = perms.has(PermissionsBitField.Flags.ManageMessages);
  // Permissions check philosophy: fail-soft and explain what’s missing.
  // Docs: https://discord.com/developers/docs/topics/permissions

  logPhase(ctx, "open_channel", {
    guildId,
    channelId: channel.id,
    hasView,
    hasSend,
    hasManageMessages: hasManage,
  });

  if (!hasView) {
    markSkippedPhase(ctx, "find_existing", { reason: "missing ViewChannel" });
    markSkippedPhase(ctx, "send_or_edit", { reason: "missing ViewChannel" });
    markSkippedPhase(ctx, "maybe_pin", { reason: "missing ViewChannel" });
    result.reason = "missing ViewChannel";
    return result;
  }

  ctx.step("find_existing");
  const existing = await findExistingGateEntry(channel, botId);
  if (existing) {
    result.messageId = existing.id;
  }
  logPhase(ctx, "find_existing", {
    channelId: channel.id,
    messageId: existing?.id ?? null,
  });

  if (!hasSend) {
    markSkippedPhase(ctx, "send_or_edit", {
      channelId: channel.id,
      messageId: existing?.id ?? null,
      reason: `missing SendMessages in #${channel.name}`,
    });
    markSkippedPhase(ctx, "maybe_pin", {
      channelId: channel.id,
      messageId: existing?.id ?? null,
      hasManageMessages: hasManage,
      reason: `missing SendMessages in #${channel.name}`,
    });
    result.reason = `missing SendMessages in #${channel.name}`;
    return result;
  }

  ctx.step("send_or_edit");
  let message: Message | null = existing ?? null;
  let created = false;
  let edited = false;

  if (message) {
    const editPayload = buildGateEntryPayload({ guild: channel.guild, config: cfg ?? null });
    try {
      await message.edit({
        embeds: editPayload.embeds,
        components: editPayload.components,
        files: editPayload.files,
        attachments: [],
      });
      edited = true;
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (code === 10008) {
        message = null;
      } else {
        throw err;
      }
    }
  }

  if (!message) {
    // Fresh send - this happens on first setup or if the old message was deleted
    const createPayload = buildGateEntryPayload({ guild: channel.guild, config: cfg ?? null });
    const sent = await channel.send(createPayload);
    message = sent;
    created = true;
  }

  result.messageId = message.id;
  result.created = created;
  result.edited = edited;
  logger.info(
    {
      channelId: channel.id,
      messageId: message.id,
      created,
      edited,
    },
    "[gate] entry posted"
  );
  logPhase(ctx, "send_or_edit", {
    channelId: channel.id,
    messageId: message.id,
    created,
    edited,
  });

  ctx.step("maybe_pin");
  if (!hasManage) {
    logPhase(ctx, "maybe_pin", {
      channelId: channel.id,
      messageId: message.id,
      hasManageMessages: false,
      reason: "missing ManageMessages",
    });
    result.reason = "missing ManageMessages";
    return result;
  }

  try {
    if (!message.pinned) {
      await message.pin();
    }
    const pinnedResponse = await channel.messages.fetchPins();
    // discord.js v14.16+ fetchPins() returns { items: Collection, hasMore: boolean }, not a bare Collection.
    const pinnedItems = (pinnedResponse as unknown as { items?: { has: (id: string) => boolean } }).items;
    const pinnedMatch = pinnedItems ? pinnedItems.has(message.id) : false;
    result.pinned = pinnedMatch;
    if (!pinnedMatch) {
      result.reason = "pin verification failed";
    }
    logPhase(ctx, "maybe_pin", {
      channelId: channel.id,
      messageId: message.id,
      hasManageMessages: true,
      pinned: pinnedMatch,
    });
    return result;
  } catch (err) {
    logPhase(ctx, "maybe_pin", {
      channelId: channel.id,
      messageId: message.id,
      hasManageMessages: true,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Entry point for gate verification flow. Triggered when user clicks "Verify" button.
 * This is HOT PATH - runs on every application start, needs to be fast.
 *
 * Key constraint: Must show modal within 3 seconds or Discord kills the interaction.
 * We do minimal validation before showModal, deferring heavy work to modal submit.
 *
 * PERFORMANCE NOTE: getOrCreateDraft does a few DB queries, but they're sync
 * (better-sqlite3) so they complete in <10ms typically. If this ever becomes
 * a bottleneck, the getQuestions call is the one to cache - it rarely changes.
 */
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
      const { startDmVerification } = await import("./gate/dmVerification.js");
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
  const draftByUserSql = `SELECT id, guild_id, user_id, status FROM application WHERE guild_id = ? AND user_id = ? AND status = ‘draft’`;
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
