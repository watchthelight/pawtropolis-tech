import Database from "better-sqlite3";
import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

vi.mock("../../src/db/connection.js", () => {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return { db };
});

import { db } from "../../src/db/connection.js";
import {
  handleGateModalSubmit,
  handleStartButton,
} from "../../src/features/gate/gateEntry.js";
import { handleFactoryResetModal } from "../../src/commands/gate.js";

beforeAll(() => {
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
    CREATE TABLE IF NOT EXISTS review_action (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id TEXT,
      moderator_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT,
      message_link TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS modmail_bridge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at  TEXT
    );
    CREATE TABLE IF NOT EXISTS user_snapshot (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      username TEXT,
      discriminator TEXT,
      global_name TEXT,
      avatar_url TEXT,
      joined_at TEXT,
      account_created_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
});

beforeEach(() => {
  db.exec(`
    DELETE FROM application_response;
    DELETE FROM review_action;
    DELETE FROM modmail_bridge;
    DELETE FROM user_snapshot;
    DELETE FROM application;
    DELETE FROM guild_question;
    DELETE FROM guild_config;
  `);
  db.prepare("INSERT INTO guild_config (guild_id, gate_channel_id) VALUES (?, ?)").run("guild-1", "1000");
  const insertQuestion = db.prepare(
    "INSERT INTO guild_question (guild_id, q_index, prompt, required) VALUES (?, ?, ?, ?)"
  );
  insertQuestion.run("guild-1", 0, "Why do you want to join?", 1);
  insertQuestion.run("guild-1", 1, "Anything else?", 0);
});

describe("gate interactions", () => {
  it("opens the first modal with existing draft values", async () => {
    const showModal = vi.fn().mockResolvedValue(undefined);
    const reply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      inGuild: () => true,
      guildId: "guild-1",
      user: { id: "user-10" },
      customId: "v1:start",
      replied: false,
      deferred: false,
      showModal,
      reply,
    } as unknown as Parameters<typeof handleStartButton>[0];

    await handleStartButton(interaction);
    expect(showModal).toHaveBeenCalledTimes(1);
    const modal = showModal.mock.calls[0][0];
    const json = modal.toJSON();
    expect(json.custom_id).toBe("v1:modal:p0");
    expect(json.components?.length).toBe(2);

    const draft = db
      .prepare("SELECT status FROM application WHERE guild_id = ? AND user_id = ?")
      .get("guild-1", "user-10") as { status: string };
    expect(draft.status).toBe("draft");
  });

  it("saves answers and submits on the last page", async () => {
    const showModal = vi.fn().mockResolvedValue(undefined);
    const startInteraction = {
      inGuild: () => true,
      guildId: "guild-1",
      user: { id: "user-11" },
      customId: "v1:start",
      replied: false,
      deferred: false,
      showModal,
      reply: vi.fn(),
    } as unknown as Parameters<typeof handleStartButton>[0];
    await handleStartButton(startInteraction);

    const fieldValues = new Map<string, string>([
      ["v1:q:0", "Because I love the community"],
      ["v1:q:1", "Looking forward to events"],
    ]);
    const reply = vi.fn().mockResolvedValue(undefined);
    const followUp = vi.fn().mockResolvedValue(undefined);
    const modalInteraction = {
      inGuild: () => true,
      guildId: "guild-1",
      user: { id: "user-11" },
      customId: "v1:modal:p0",
      replied: false,
      deferred: false,
      fields: {
        getTextInputValue: (id: string) => fieldValues.get(id) ?? "",
      },
      reply,
      followUp,
    } as unknown as Parameters<typeof handleGateModalSubmit>[0];

    await handleGateModalSubmit(modalInteraction);
    expect(reply).toHaveBeenCalledTimes(1);
    const payload = reply.mock.calls[0][0];
    expect(payload.content).toContain("Application submitted");
    const rowJson = payload.components?.[0]
      ?.toJSON() as { components: Array<{ custom_id?: string }> } | undefined;
    expect(rowJson?.components[0].custom_id).toBe("v1:done");

    const app = db
      .prepare("SELECT status FROM application WHERE guild_id = ? AND user_id = ?")
      .get("guild-1", "user-11") as { status: string };
    expect(app.status).toBe("submitted");

    const answers = db
      .prepare("SELECT q_index, answer FROM application_response WHERE app_id = (SELECT id FROM application WHERE guild_id = ? AND user_id = ?)")
      .all("guild-1", "user-11") as Array<{ q_index: number; answer: string }>;
    expect(answers).toEqual([
      { q_index: 0, answer: "Because I love the community" },
      { q_index: 1, answer: "Looking forward to events" },
    ]);
  });

  it("rejects factory reset when confirmation mismatch", async () => {
    db.prepare("INSERT INTO application (id, guild_id, user_id, status) VALUES (?, ?, ?, 'submitted')").run(
      "app-1",
      "guild-1",
      "user-1"
    );
    const reply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      inGuild: () => true,
      guildId: "guild-1",
      member: {
        permissions: { has: () => true },
        roles: { cache: new Map() },
      },
      customId: "v1:factory-reset",
      fields: {
        getTextInputValue: () => "nope",
      },
      reply,
    } as unknown as Parameters<typeof handleFactoryResetModal>[0];
    await handleFactoryResetModal(interaction);
    expect(reply).toHaveBeenCalledWith({ ephemeral: true, content: "Nope." });
    const remaining = db.prepare("SELECT COUNT(*) as count FROM application").get() as { count: number };
    expect(remaining.count).toBe(1);
  });

  it("wipes tables on factory reset success", async () => {
    db.prepare("INSERT INTO application (id, guild_id, user_id, status) VALUES (?, ?, ?, 'draft')").run(
      "app-2",
      "guild-1",
      "user-2"
    );
    db.prepare(
      "INSERT INTO application_response (app_id, q_index, question, answer) VALUES (?, ?, ?, ?)"
    ).run("app-2", 0, "Q", "A");
    db.prepare(
      "INSERT INTO review_action (app_id, moderator_id, action) VALUES (?, ?, 'accept')"
    ).run("app-2", "mod-1");
    db.prepare(
      "INSERT INTO modmail_bridge (guild_id, user_id, thread_id, state) VALUES (?, ?, ?, 'open')"
    ).run("guild-1", "user-2", "thread-1");
    db.prepare(
      "INSERT INTO user_snapshot (guild_id, user_id, username) VALUES (?, ?, ?)"
    ).run("guild-1", "user-2", "tester");
    db.prepare("INSERT INTO guild_question (guild_id, q_index, prompt, required) VALUES (?, ?, ?, ?)").run(
      "guild-1",
      2,
      "Another",
      1
    );
    const reply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      inGuild: () => true,
      guildId: "guild-1",
      member: {
        permissions: { has: () => true },
        roles: { cache: new Map() },
      },
      customId: "v1:factory-reset",
      fields: {
        getTextInputValue: () => "RESET",
      },
      reply,
    } as unknown as Parameters<typeof handleFactoryResetModal>[0];

    await handleFactoryResetModal(interaction);
    expect(reply).toHaveBeenCalledWith({ ephemeral: true, content: "Factory reset complete." });
    const count = (table: string) =>
      (db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number }).count;
    expect(count("application")).toBe(0);
    expect(count("application_response")).toBe(0);
    expect(count("review_action")).toBe(0);
    expect(count("modmail_bridge")).toBe(0);
    expect(count("user_snapshot")).toBe(0);
    expect(count("guild_question")).toBe(0);
  });
});
