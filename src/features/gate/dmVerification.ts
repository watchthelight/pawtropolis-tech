/**
 * Pawtropolis Tech — src/features/gate/dmVerification.ts
 * WHAT: DM-based gate verification flow — replaces Discord modals
 * WHY: Modal labels cap at 45 chars, DMs allow full question text with no limits
 * FLOWS:
 *  - User clicks Verify → bot DMs first question → user replies → next question → summary → submit
 *  - DM failure → ephemeral warning to enable DMs
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  type ButtonInteraction,
  type Message,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from "discord.js";
import { randomUUID } from "node:crypto";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { captureException } from "../../lib/sentry.js";
import { cacheUser } from "../../lib/userCache.js";
import { getConfig } from "../../lib/config.js";
import { getQuestions } from "./questions.js";
import { isPanicMode } from "../panicStore.js";
import { ensureReviewMessage } from "../review.js";
import { notifyDashboard } from "../../web/notifyDashboard.js";
import { logActionPretty } from "../../logging/pretty.js";
import {
  BRAND_COLOR,
  type GateQuestion,
  getOrCreateDraft,
  getDraft,
  upsertAnswer,
  submitApplication,
  queueAvatarScan,
  paginate,
  buildModalForPage,
} from "../gate.js";

// ============================================================================
// Session Management
// ============================================================================

interface DmSession {
  guildId: string;
  userId: string;
  appId: string;
  nonce: string;
  questions: GateQuestion[];
  answers: Map<number, string>;
  currentQuestionIndex: number;
  startedAt: number;
  phase: "questioning" | "summary";
  /**
   * When set, the verification flow runs in this thread channel ID instead of
   * the user's DM. The thread is a per-user private verify thread (see
   * src/features/gate/threadGate.ts). Non-DM session messages still use
   * `message.channel.send()` (already channel-agnostic), so this field only
   * influences the FIRST question delivery and the acknowledgement reply text.
   */
  targetChannelId?: string;
}

const activeSessions = new Map<string, DmSession>();

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// Cleanup stale sessions every 5 minutes
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, session] of activeSessions) {
    if (now - session.startedAt > SESSION_TIMEOUT_MS) {
      activeSessions.delete(key);
      logger.debug({ key, userId: session.userId }, "[dmVerify] Session timed out");
    }
  }
}, 5 * 60 * 1000);
cleanupTimer.unref();

function sessionKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

export function hasActiveSession(userId: string): boolean {
  for (const session of activeSessions.values()) {
    if (session.userId === userId) return true;
  }
  return false;
}

function getSessionForUser(userId: string): DmSession | undefined {
  for (const session of activeSessions.values()) {
    if (session.userId === userId) return session;
  }
  return undefined;
}

export function cleanupSession(guildId: string, userId: string): void {
  activeSessions.delete(sessionKey(guildId, userId));
}

// ============================================================================
// Question & Summary Embeds
// ============================================================================

function buildQuestionEmbed(question: GateQuestion, index: number, total: number): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`Question ${index + 1} of ${total}`)
    .setDescription(question.prompt)
    .setColor(BRAND_COLOR)
    .setFooter({ text: "Type your answer below" });
}

function buildCancelRow(nonce: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`v1:dm:cancel:${nonce}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("❌")
  );
}

function buildSummaryEmbed(session: DmSession): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle("Application Summary")
    .setDescription("Review your answers below. Click **Submit** when ready, or **Cancel** to discard.")
    .setColor(BRAND_COLOR);

  for (const question of session.questions) {
    const answer = session.answers.get(question.q_index) ?? "_No answer_";
    const label = `${question.q_index + 1}. ${question.prompt}`;
    // Embed field name max is 256, value max is 1024
    embed.addFields({
      name: label.length > 256 ? label.slice(0, 253) + "..." : label,
      value: answer.length > 1024 ? answer.slice(0, 1021) + "..." : answer,
      inline: false,
    });
  }

  return embed;
}

function buildSummaryRow(nonce: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`v1:dm:submit:${nonce}`)
      .setLabel("Submit Application")
      .setStyle(ButtonStyle.Success)
      .setEmoji("✅"),
    new ButtonBuilder()
      .setCustomId(`v1:dm:cancel:${nonce}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("❌")
  );
}

// ============================================================================
// Entry Point
// ============================================================================

export async function startDmVerification(
  interaction: ButtonInteraction,
  guildId: string,
  userId: string
): Promise<void> {
  // Defer in thread mode to extend the 3s interaction window past slow
  // DB writes / DM sends. DM mode (no thread) keeps the synchronous reply
  // path because the fallback uses interaction.showModal(), which Discord
  // rejects after deferReply/reply.
  const isThreadInteraction = interaction.channel?.isThread() ?? false;
  if (isThreadInteraction && !interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  // Helper that picks reply vs editReply based on whether we deferred.
  const respond = async (content: string): Promise<void> => {
    if (interaction.deferred) {
      await interaction.editReply({ content });
    } else if (!interaction.replied) {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  };

  // Check for existing active session.
  // NOTE: sessions are keyed by guild+user, but answer routing (handleDmAnswer)
  // and button routing (handleDmButton) look sessions up by userId alone (a DM
  // carries no guildId). Allowing a second active session for the same user in
  // another guild would let a DM answer be persisted against the wrong guild's
  // application. So we disallow more than one active session per user globally;
  // this keeps getSessionForUser deterministic.
  const existingKey = sessionKey(guildId, userId);
  if (activeSessions.has(existingKey) || hasActiveSession(userId)) {
    await respond("You already have a verification in progress! Check your DMs.");
    return;
  }

  // Panic mode check
  if (isPanicMode(guildId)) {
    await respond("Applications are temporarily paused. Please try again later.");
    return;
  }

  // Load questions
  const rawQuestions = getQuestions(guildId);
  if (rawQuestions.length === 0) {
    await respond("No verification questions are configured. Please contact staff.");
    return;
  }

  const questions: GateQuestion[] = rawQuestions.map((q) => ({
    q_index: q.q_index,
    prompt: q.prompt,
    required: q.required === 1,
  }));

  if (questions.length === 0) {
    await respond("No verification questions are configured. Please contact staff.");
    return;
  }

  // Create or reuse draft
  let appId: string;
  try {
    const draft = getOrCreateDraft(db, guildId, userId);
    appId = draft.application_id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("permanently rejected")) {
      await respond("You have been permanently rejected from this server.");
    } else if (msg.includes("already submitted")) {
      await respond("You already have a submitted application under review.");
    } else {
      await respond("Something went wrong. Please try again.");
      captureException(err);
    }
    return;
  }

  // Load existing draft answers for resume
  const draftData = getDraft(db, appId);
  const existingAnswers = new Map<number, string>();
  if (draftData?.responses) {
    for (const r of draftData.responses) {
      if (r.answer && r.answer.trim().length > 0) {
        existingAnswers.set(r.q_index, r.answer);
      }
    }
  }

  // Find starting question (first unanswered required question, or first question)
  let startIndex = 0;
  if (existingAnswers.size > 0) {
    const firstUnanswered = questions.findIndex(
      (q) => q.required && !existingAnswers.has(q.q_index)
    );
    startIndex = firstUnanswered >= 0 ? firstUnanswered : 0;
  }

  // Detect thread context. When the Verify button is clicked inside a private
  // verify thread (the new threadGate.ts entry point), send the first question
  // to the thread instead of the user's DM. This avoids any DM at all and
  // satisfies Discord Developer Policy Rule 5 (no unsolicited DMs) — the user
  // explicitly clicked the button to start the flow.
  const targetThread = interaction.channel?.isThread() ? interaction.channel : null;

  // Try to send the first question
  const nonce = randomUUID().slice(0, 8);
  const firstQuestion = questions[startIndex]!;
  const embed = buildQuestionEmbed(firstQuestion, startIndex, questions.length);

  try {
    if (targetThread) {
      await targetThread.send({
        embeds: [embed],
        components: [buildCancelRow(nonce)],
      });
    } else {
      await interaction.user.send({
        embeds: [embed],
        components: [buildCancelRow(nonce)],
      });
    }
  } catch (err: unknown) {
    // Thread send failures are unexpected (we own the thread). DM failures are
    // common: 50007 (DMs closed), 20026 (bot quarantined), 50278 (no mutual guilds)
    // For DM mode, fall back to the modal-based verification flow.
    const code = (err as { code?: number })?.code;
    logger.info(
      { userId, guildId, errCode: code, thread: Boolean(targetThread) },
      "[dmVerify] first-question send failed"
    );

    if (targetThread) {
      // Thread send failure — we already deferred, so showModal is no longer
      // valid (Discord rejects modals after defer/reply). Surface the failure
      // via editReply instead.
      await respond("Something went wrong starting verification. Please contact staff.");
      return;
    }

    // DM mode (not deferred) — fall back to the modal flow so the user can
    // still complete verification in pages. This is the only path for users
    // who keep DMs closed, so we keep it rather than refusing them.
    try {
      const pages = paginate(questions);
      const modal = buildModalForPage(pages[0]!, existingAnswers, appId);
      await interaction.showModal(modal);
    } catch (modalErr) {
      captureException(modalErr);
      await respond("Something went wrong. Please try again.");
    }
    return;
  }

  // First question delivered — create session
  const session: DmSession = {
    guildId,
    userId,
    appId,
    nonce,
    questions,
    answers: existingAnswers,
    currentQuestionIndex: startIndex,
    startedAt: Date.now(),
    phase: "questioning",
    targetChannelId: targetThread?.id,
  };
  activeSessions.set(existingKey, session);

  // Acknowledge — wording depends on whether we sent to thread or DM
  await respond(
    targetThread
      ? "Verification started — please answer the questions above."
      : "Check your DMs! I've sent you the verification questions."
  );

  logger.info(
    {
      guildId,
      userId,
      appId,
      questionCount: questions.length,
      startIndex,
      targetChannelId: session.targetChannelId,
    },
    "[dmVerify] verification started"
  );
}

// ============================================================================
// Answer Handler
// ============================================================================

export async function handleDmAnswer(message: Message): Promise<void> {
  const session = getSessionForUser(message.author.id);
  if (!session) return;

  // Ignore messages during summary phase
  if (session.phase === "summary") {
    await message.reply("Use the buttons above to submit or cancel your application.");
    return;
  }

  const question = session.questions[session.currentQuestionIndex]!;
  const answer = message.content.trim();

  // Validate required questions
  if (question.required && answer.length === 0) {
    await message.reply("This question is required. Please provide an answer.");
    return;
  }

  // Store answer
  if (answer.length > 0) {
    session.answers.set(question.q_index, answer);

    // Persist to DB immediately. Retry on SQLITE_BUSY since concurrent verifications
    // can briefly hold the write lock past the busy_timeout PRAGMA.
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        upsertAnswer(db, session.appId, question.q_index, answer);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const code = (err as { code?: string })?.code;
        if (code !== "SQLITE_BUSY" && code !== "SQLITE_BUSY_SNAPSHOT") break;
        await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
      }
    }
    if (lastErr) {
      logger.error({ err: lastErr, appId: session.appId, qIndex: question.q_index }, "[dmVerify] Failed to save answer");
      await message.reply("Failed to save your answer. Please try again.");
      return;
    }
  }

  // Move to next question
  const nextIndex = session.currentQuestionIndex + 1;

  // Type guard: DM channels always support send(), but the union type from message.channel
  // includes PartialGroupDMChannel which doesn't. Narrow to a sendable channel.
  if (!("send" in message.channel)) return;

  if (nextIndex < session.questions.length) {
    // Send next question
    session.currentQuestionIndex = nextIndex;
    const nextQuestion = session.questions[nextIndex]!;
    const embed = buildQuestionEmbed(nextQuestion, nextIndex, session.questions.length);

    await message.channel.send({
      embeds: [embed],
      components: [buildCancelRow(session.nonce)],
    });
  } else {
    // All questions answered — show summary
    session.phase = "summary";
    const summaryEmbed = buildSummaryEmbed(session);

    await message.channel.send({
      embeds: [summaryEmbed],
      components: [buildSummaryRow(session.nonce)],
    });

    logger.info(
      { userId: session.userId, appId: session.appId },
      "[dmVerify] All questions answered, summary shown"
    );
  }
}

// ============================================================================
// Button Handler (Submit / Cancel)
// ============================================================================

export async function handleDmButton(interaction: ButtonInteraction): Promise<void> {
  const session = getSessionForUser(interaction.user.id);
  if (!session) {
    await interaction.reply({
      content: "No active verification session. Click **Verify** in the server to start.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const parts = interaction.customId.split(":"); // v1:dm:action:nonce
  const action = parts[2];
  const nonce = parts[3];

  // Reject stale buttons from old sessions
  if (nonce && nonce !== session.nonce) {
    await interaction.reply({
      content: "This button is from an old session. Use the buttons on your latest question.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "cancel") {
    await handleCancel(interaction, session);
  } else if (action === "submit") {
    await handleSubmit(interaction, session);
  }
}

async function handleCancel(interaction: ButtonInteraction, session: DmSession): Promise<void> {
  // Delete draft and responses
  try {
    db.prepare("DELETE FROM application_response WHERE app_id = ?").run(session.appId);
    db.prepare("DELETE FROM application WHERE id = ? AND status = 'draft'").run(session.appId);
  } catch (err) {
    logger.warn({ err, appId: session.appId }, "[dmVerify] Failed to delete draft on cancel");
  }

  cleanupSession(session.guildId, session.userId);

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle("Verification Cancelled")
        .setDescription("No changes were made. You can start over by clicking **Verify** in the server.")
        .setColor(0x808080),
    ],
    components: [],
  });

  logger.info({ userId: session.userId, appId: session.appId }, "[dmVerify] Cancelled by user");
}

async function handleSubmit(interaction: ButtonInteraction, session: DmSession): Promise<void> {
  await interaction.deferUpdate();

  // Final validation — check all required questions have answers
  const missing = session.questions.filter(
    (q) => q.required && !session.answers.has(q.q_index)
  );

  if (missing.length > 0) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Missing Required Answers")
          .setDescription(
            "You're missing answers to required questions:\n" +
            missing.map((q) => `• ${q.prompt}`).join("\n") +
            "\n\nPlease click Verify in the server to restart."
          )
          .setColor(0xff0000),
      ],
      components: [],
    });
    cleanupSession(session.guildId, session.userId);
    return;
  }

  // Submit the application
  try {
    submitApplication(db, session.appId);
  } catch (err) {
    logger.error({ err, appId: session.appId }, "[dmVerify] Failed to submit application");
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Submission Failed")
          .setDescription("Something went wrong. Please try again or contact staff.")
          .setColor(0xff0000),
      ],
      components: [],
    });
    cleanupSession(session.guildId, session.userId);
    return;
  }

  // Cache user for review card display
  const guild = interaction.client.guilds.cache.get(session.guildId);
  if (guild) {
    const member = await guild.members.fetch(session.userId).catch(() => null);
    cacheUser(interaction.user, session.guildId, member);
  }

  // Queue avatar scan
  const cfg = getConfig(session.guildId);
  if (cfg?.avatar_scan_enabled) {
    queueAvatarScan({
      appId: session.appId,
      user: interaction.user,
      cfg,
      client: interaction.client,
    });
  }

  // Post review card
  try {
    await ensureReviewMessage(interaction.client, session.appId);
  } catch (err) {
    logger.error({ err, appId: session.appId }, "[dmVerify] Failed to create review card");
  }

  // Notify dashboard
  notifyDashboard("review:submitted", {
    appId: session.appId,
    applicantName: interaction.user.username,
  });

  // Log action (guild may be uncached; logActionPretty dereferences guild.id)
  if (guild) {
    await logActionPretty(guild, {
      actorId: session.userId,
      subjectId: session.userId,
      action: "gate_submit",
      reason: "Application submitted via DM verification",
      meta: { appId: session.appId, questionCount: session.questions.length },
    }).catch((err) => {
      logger.warn({ err }, "[dmVerify] Failed to log submit action");
    });
  } else {
    logger.warn(
      { guildId: session.guildId, appId: session.appId },
      "[dmVerify] guild not cached; skipped gate_submit audit log"
    );
  }

  // Update DM with confirmation
  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle("Application Submitted!")
        .setDescription(
          "Your application has been submitted. Staff will review it shortly.\n\n" +
          "You'll be notified when a decision is made."
        )
        .setColor(0x00cc00),
    ],
    components: [],
  });

  cleanupSession(session.guildId, session.userId);

  logger.info(
    { guildId: session.guildId, userId: session.userId, appId: session.appId },
    "[dmVerify] Application submitted successfully"
  );
}
