/**
 * Pawtropolis Tech -- src/features/gate/drafts.ts
 * WHAT: Gate question/modal builders + draft application persistence
 *       (getOrCreateDraft, getDraft, upsertAnswer, submitApplication).
 * WHY: Extracted from gate.ts (#00011) to isolate the persistence + modal-build
 *       concern from the interaction handlers.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import type { Database as BetterSqliteDatabase } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { logger } from "../../lib/logger.js";
import { getConfig } from "../../lib/config.js";
import { shortCode } from "../../lib/ids.js";
import { touchSyncMarker } from "../../lib/syncMarker.js";
import type { CmdCtx } from "../../lib/cmdWrap.js";
import { withSql } from "../../lib/cmdWrap.js";
import { getQuestions as getQuestionsShared } from "./questions.js";

// Discord modal limits - these are API-enforced, not arbitrary.
// See: https://discord.com/developers/docs/interactions/message-components#text-inputs
const DEFAULT_ANSWER_MAX_LENGTH = 1000;
/*
 * GOTCHA: INPUT_MAX_LENGTH and LABEL_MAX_LENGTH are different things.
 * INPUT_MAX_LENGTH is how much text the user can type (1000 chars).
 * LABEL_MAX_LENGTH is how long the question label can be (45 chars).
 * Confuse these and Discord throws cryptic "Invalid Form Body" errors.
 */
const INPUT_MAX_LENGTH = 1000;

/**
 * getAnswerMaxLength
 * WHAT: Get the max character length for gate answers
 * WHY: Now configurable via /config set gate_answer_length (100-4000)
 */
export function getAnswerMaxLength(guildId: string): number {
  const cfg = getConfig(guildId);
  return cfg?.gate_answer_max_length ?? DEFAULT_ANSWER_MAX_LENGTH;
}
const LABEL_MAX_LENGTH = 45;    // Discord enforces 45 chars max for labels
const PLACEHOLDER_MAX_LENGTH = 100;

// schema is now application_id, edge_score (no legacy columns)

export type GateQuestion = {
  q_index: number;
  prompt: string;
  required: boolean;
};

type QuestionPage = {
  pageIndex: number;
  questions: GateQuestion[];
};


export function getQuestions(guildId: string): GateQuestion[] {
  const rows = getQuestionsShared(guildId);

  if (rows.length === 0) {
    logger.info(
      {
        evt: "gate_questions_empty",
        guildId,
      },
      `[gate] 0 questions for guild=${guildId}. Insert rows into guild_question for this guild.`
    );
  }

  return rows.map((row) => ({
    q_index: row.q_index,
    prompt: row.prompt,
    required: row.required === 1,
  }));
}

/**
 * Discord modals allow max 5 inputs per modal. When we have more than 5 questions,
 * we need to split them across multiple "pages". Each page becomes its own modal.
 * pageSize defaults to 5 (the Discord max) but is parameterized for testing.
 *
 * EDGE CASE: If a guild has 0 questions configured, this returns an empty array.
 * Callers must handle that - don't just blindly access pages[0].
 */
export function paginate(questions: GateQuestion[], pageSize = 5): QuestionPage[] {
  if (pageSize <= 0) throw new Error("pageSize must be positive");
  const pages: QuestionPage[] = [];
  for (let i = 0; i < questions.length; i += pageSize) {
    const slice = questions.slice(i, i + pageSize);
    pages.push({ pageIndex: pages.length, questions: slice });
  }
  return pages;
}

/*
 * The customId format "v1:modal:{appId}:p{pageIndex}" is load-bearing.
 * The modal submit handler parses this to find the app and page.
 * If you change this format, update handleGateModalSubmit's regex too.
 */
export function buildModalForPage(
  page: QuestionPage,
  draftAnswersMap: Map<number, string>,
  appId: string
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`v1:modal:${appId}:p${page.pageIndex}`)
    .setTitle(`Gate Entry - Page ${page.pageIndex + 1}`);

  const rows = page.questions.map((question) => {
    const label =
      question.prompt.length > LABEL_MAX_LENGTH
        ? `${question.prompt.slice(0, LABEL_MAX_LENGTH - 3)}...`
        : question.prompt || `Question ${question.q_index + 1}`;
    const placeholder =
      question.prompt.length > PLACEHOLDER_MAX_LENGTH
        ? question.prompt.slice(0, PLACEHOLDER_MAX_LENGTH)
        : question.prompt;
    const input = new TextInputBuilder()
      .setCustomId(`v1:q:${question.q_index}`)
      .setLabel(label)
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(INPUT_MAX_LENGTH)
      .setRequired(question.required);
    if (placeholder) {
      input.setPlaceholder(placeholder);
    }
    const existing = draftAnswersMap.get(question.q_index);
    if (existing) {
      input.setValue(existing.slice(0, INPUT_MAX_LENGTH));
    }
    return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  });
  if (rows.length === 0) {
    throw new Error("Cannot build modal without inputs");
  }
  modal.addComponents(...rows);
  return modal;
}

/**
 * Idempotent draft retrieval - either finds existing draft or creates a new one.
 * Throws on: permanent rejection, already-submitted application.
 *
 * Order of checks matters:
 * 1. Permanent rejection - user is banned, hard stop
 * 2. Existing draft - reuse it (don't create duplicates)
 * 3. Active submission - prevent duplicate applications in review queue
 * 4. Create new draft
 *
 * Edge case: User with 'needs_info' status trying to start fresh. We block this
 * because 'needs_info' implies staff is waiting for a response on their existing app.
 */
export function getOrCreateDraft(db: BetterSqliteDatabase, guildId: string, userId: string) {
  const permReject = db
    .prepare(
      `SELECT permanently_rejected FROM application WHERE guild_id = ? AND user_id = ? AND permanently_rejected = 1 LIMIT 1`
    )
    .get(guildId, userId) as { permanently_rejected: number } | undefined;
  if (permReject) {
    throw new Error("User is permanently rejected");
  }

  const existing = db
    .prepare(`SELECT id FROM application WHERE guild_id = ? AND user_id = ? AND status = 'draft'`)
    .get(guildId, userId) as { id: string } | undefined;
  if (existing) return { application_id: existing.id };

  const active = db
    .prepare(
      `SELECT id, status FROM application WHERE guild_id = ? AND user_id = ? AND status IN ('submitted','needs_info')`
    )
    .get(guildId, userId) as { id: string; status: string } | undefined;
  if (active) {
    throw new Error("Active application already submitted");
  }

  const id = randomUUID();
  const code = shortCode(id);

  /*
   * Short code collision cleanup - yes, this is ugly, and yes, we need it.
   * shortCode() truncates UUIDs to 8 chars for readability. With enough apps,
   * collisions happen. We only delete TERMINAL apps (approved/rejected/kicked)
   * to free up the code for reuse. Active apps keep their codes.
   *
   * "But why not just use longer codes?" Because staff yells "ABC12345" over
   * voice chat during busy review sessions, and 8 chars is already pushing it.
   */
  // Delete any resolved application with the same shortCode to allow reuse
  // Only deletes terminal statuses (approved, rejected, kicked)
  // Active apps (draft, submitted, needs_info) are never deleted
  // Note: Permanently rejected apps have status='rejected' with permanently_rejected=1
  const resolvedApps = db.prepare(
    `SELECT id FROM application
     WHERE guild_id = ?
     AND status IN ('approved', 'rejected', 'kicked')`
  ).all(guildId) as Array<{ id: string }>;

  // Prepare statement once outside loop to avoid N+1 query pattern
  const deleteStmt = db.prepare(`DELETE FROM application WHERE id = ?`);
  for (const app of resolvedApps) {
    if (shortCode(app.id) === code) {
      deleteStmt.run(app.id);
      break; // Only one collision possible per code
    }
  }

  db.prepare(
    `
      INSERT INTO application (id, guild_id, user_id, status)
      VALUES (?, ?, ?, 'draft')
    `
  ).run(id, guildId, userId);
  touchSyncMarker("application_create");
  return { application_id: id };
}

export function getDraft(db: BetterSqliteDatabase, appId: string, ctx?: CmdCtx) {
  const selectAppSql = `SELECT id, guild_id, user_id, status FROM application WHERE id = ?`;
  const app = (
    ctx
      ? withSql(ctx, selectAppSql, () => db.prepare(selectAppSql).get(appId))
      : db.prepare(selectAppSql).get(appId)
  ) as { id: string; guild_id: string; user_id: string; status: string } | undefined;
  if (!app) return undefined;
  const selectResponsesSql = `
        SELECT q_index, answer
        FROM application_response
        WHERE app_id = ?
      `;
  const responses = (
    ctx
      ? withSql(ctx, selectResponsesSql, () => db.prepare(selectResponsesSql).all(appId))
      : db.prepare(selectResponsesSql).all(appId)
  ) as Array<{ q_index: number; answer: string }>;
  return { application: app, responses };
}

/*
 * Why so many SQL lookups just to save one answer? Trust issues, mostly.
 * We verify the app exists, then verify the question exists for this guild,
 * THEN we write. Yes, it's 3 queries where 1 might work. But the debugging
 * time saved when something goes wrong is worth the extra roundtrips.
 */
export function upsertAnswer(
  db: BetterSqliteDatabase,
  appId: string,
  q_index: number,
  value: string,
  ctx?: CmdCtx
) {
  const selectGuildSql = `SELECT guild_id FROM application WHERE id = ?`;
  const app = (
    ctx
      ? withSql(ctx, selectGuildSql, () => db.prepare(selectGuildSql).get(appId))
      : db.prepare(selectGuildSql).get(appId)
  ) as { guild_id: string } | undefined;
  if (!app) throw new Error("Draft not found");

  const selectQuestionSql = `
        SELECT prompt
        FROM guild_question
        WHERE guild_id = ? AND q_index = ?
      `;
  const question = (
    ctx
      ? withSql(ctx, selectQuestionSql, () =>
          db.prepare(selectQuestionSql).get(app.guild_id, q_index)
        )
      : db.prepare(selectQuestionSql).get(app.guild_id, q_index)
  ) as { prompt: string } | undefined;
  if (!question) throw new Error("Question not found");

  const answerMaxLength = getAnswerMaxLength(app.guild_id);
  const trimmed = value.length > answerMaxLength ? value.slice(0, answerMaxLength) : value;

  const upsertSql = `
      INSERT INTO application_response (app_id, q_index, question, answer, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(app_id, q_index) DO UPDATE SET
        question = excluded.question,
        answer = excluded.answer,
        created_at = datetime('now')
    `;
  if (ctx) {
    withSql(ctx, upsertSql, () =>
      db.prepare(upsertSql).run(appId, q_index, question.prompt, trimmed)
    );
  } else {
    db.prepare(upsertSql).run(appId, q_index, question.prompt, trimmed);
  }
}

export function submitApplication(db: BetterSqliteDatabase, appId: string, ctx?: CmdCtx) {
  const submitSql = `
      UPDATE application
      SET status = 'submitted',
          submitted_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ? AND status = 'draft'
    `;
  const result = ctx
    ? withSql(ctx, submitSql, () => db.prepare(submitSql).run(appId))
    : db.prepare(submitSql).run(appId);
  if (result.changes === 0) {
    throw new Error("No draft to submit");
  }
}
