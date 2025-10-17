// SPDX-License-Identifier: LicenseRef-ANW-1.0
import type { Database as BetterSqliteDatabase } from "better-sqlite3";
import { randomUUID } from "node:crypto";

const ANSWER_MAX_LENGTH = 1000;

export function getOrCreateDraft(db: BetterSqliteDatabase, guildId: string, userId: string) {
  const existing = db
    .prepare(
      `SELECT id FROM application WHERE guild_id = ? AND user_id = ? AND status = 'draft'`
    )
    .get(guildId, userId) as { id: string } | undefined;
  if (existing) return { application_id: existing.id };

  const active = db
    .prepare(
      `SELECT id, status FROM application WHERE guild_id = ? AND user_id = ? AND status = 'submitted'`
    )
    .get(guildId, userId) as { id: string; status: string } | undefined;
  if (active) {
    throw new Error("Active application already submitted");
  }

  const id = randomUUID();
  db.prepare(
    `
      INSERT INTO application (id, guild_id, user_id, status)
      VALUES (?, ?, ?, 'draft')
    `
  ).run(id, guildId, userId);
  return { application_id: id };
}

export function getDraft(db: BetterSqliteDatabase, appId: string) {
  const app = db
    .prepare(`SELECT id, guild_id, user_id, status FROM application WHERE id = ?`)
    .get(appId) as { id: string; guild_id: string; user_id: string; status: string } | undefined;
  if (!app) return undefined;
  const responses = db
    .prepare(
      `
        SELECT q_index, answer
        FROM application_response
        WHERE app_id = ?
      `
    )
    .all(appId) as Array<{ q_index: number; answer: string }>;
  return { application: app, responses };
}

export function upsertAnswer(db: BetterSqliteDatabase, appId: string, q_index: number, value: string) {
  const app = db
    .prepare(`SELECT guild_id FROM application WHERE id = ?`)
    .get(appId) as { guild_id: string } | undefined;
  if (!app) throw new Error("Draft not found");

  const question = db
    .prepare(
      `
        SELECT prompt
        FROM guild_question
        WHERE guild_id = ? AND q_index = ?
      `
    )
    .get(app.guild_id, q_index) as { prompt: string } | undefined;
  if (!question) throw new Error("Question not found");

  const trimmed = value.length > ANSWER_MAX_LENGTH ? value.slice(0, ANSWER_MAX_LENGTH) : value;

  db.prepare(
    `
      INSERT INTO application_response (app_id, q_index, question, answer, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(app_id, q_index) DO UPDATE SET
        question = excluded.question,
        answer = excluded.answer,
        created_at = datetime('now')
    `
  ).run(appId, q_index, question.prompt, trimmed);
}

export function submitApplication(db: BetterSqliteDatabase, appId: string) {
  const result = db
    .prepare(
      `
      UPDATE application
      SET status = 'submitted',
          submitted_at = datetime('now')
      WHERE id = ? AND status = 'draft'
    `
    )
    .run(appId);
  if (result.changes === 0) {
    throw new Error("No draft to submit");
  }
}
