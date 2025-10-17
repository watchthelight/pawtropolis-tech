// SPDX-License-Identifier: LicenseRef-ANW-1.0
import Database from "better-sqlite3";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  getOrCreateDraft,
  getDraft,
  submitApplication,
  upsertAnswer,
} from "../../src/features/gate/repo.js";

const db = new Database(":memory:");

beforeAll(() => {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_config (
      guild_id TEXT PRIMARY KEY,
      review_channel_id     TEXT,
      gate_channel_id       TEXT,
      unverified_channel_id TEXT,
      general_channel_id    TEXT,
      accepted_role_id      TEXT,
      reviewer_role_id      TEXT,
      image_search_url_template TEXT NOT NULL DEFAULT 'https://lens.google.com/uploadbyurl?url={avatarUrl}',
      reapply_cooldown_hours   INTEGER NOT NULL DEFAULT 24,
      min_account_age_hours    INTEGER NOT NULL DEFAULT 0,
      min_join_age_hours       INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS application (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      status   TEXT NOT NULL DEFAULT 'draft',
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      submitted_at TEXT,
      resolved_at  TEXT,
      resolver_id  TEXT,
      resolution_reason TEXT,
      FOREIGN KEY (guild_id) REFERENCES guild_config(guild_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS application_response (
      app_id   TEXT NOT NULL,
      q_index  INTEGER NOT NULL,
      question TEXT NOT NULL,
      answer   TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (app_id, q_index),
      FOREIGN KEY (app_id) REFERENCES application(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS guild_question (
      guild_id TEXT NOT NULL,
      q_index  INTEGER NOT NULL,
      prompt   TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (guild_id, q_index),
      FOREIGN KEY (guild_id) REFERENCES guild_config(guild_id) ON DELETE CASCADE
    );
  `);
});

beforeEach(() => {
  db.exec(`
    DELETE FROM application_response;
    DELETE FROM application;
    DELETE FROM guild_question;
    DELETE FROM guild_config;
  `);
  db.prepare("INSERT INTO guild_config (guild_id) VALUES (?)").run("guild-1");
  const insertQuestion = db.prepare(
    "INSERT INTO guild_question (guild_id, q_index, prompt, required) VALUES (?, ?, ?, ?)"
  );
  insertQuestion.run("guild-1", 0, "First", 1);
  insertQuestion.run("guild-1", 1, "Second", 0);
});

describe("gate repo", () => {
  it("creates a draft once per user", () => {
    const first = getOrCreateDraft(db, "guild-1", "user-1");
    const second = getOrCreateDraft(db, "guild-1", "user-1");
    expect(first.application_id).toBe(second.application_id);
  });

  it("upserts answers for questions", () => {
    const { application_id } = getOrCreateDraft(db, "guild-1", "user-2");
    upsertAnswer(db, application_id, 0, "hello");
    upsertAnswer(db, application_id, 1, " world ");
    upsertAnswer(db, application_id, 1, "updated");

    const res = db
      .prepare("SELECT q_index, answer FROM application_response WHERE app_id = ? ORDER BY q_index")
      .all(application_id) as Array<{ q_index: number; answer: string }>;
    expect(res).toEqual([
      { q_index: 0, answer: "hello" },
      { q_index: 1, answer: "updated" },
    ]);
  });

  it("returns draft details with responses", () => {
    const { application_id } = getOrCreateDraft(db, "guild-1", "user-3");
    upsertAnswer(db, application_id, 0, "saved");

    const draft = getDraft(db, application_id);
    expect(draft?.application.id).toBe(application_id);
    expect(draft?.responses).toEqual([{ q_index: 0, answer: "saved" }]);
  });

  it("submits the draft", () => {
    const { application_id } = getOrCreateDraft(db, "guild-1", "user-4");
    upsertAnswer(db, application_id, 0, "ready");

    submitApplication(db, application_id);
    const row = db
      .prepare("SELECT status, submitted_at FROM application WHERE id = ?")
      .get(application_id) as { status: string; submitted_at: string };
    expect(row.status).toBe("submitted");
    expect(row.submitted_at).toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
