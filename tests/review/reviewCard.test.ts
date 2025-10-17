// SPDX-License-Identifier: LicenseRef-ANW-1.0
import Database from "better-sqlite3";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { ChannelType, type Client } from "discord.js";

vi.mock("../../src/db/connection.js", () => {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return { db };
});

import { db } from "../../src/db/connection.js";
import { ensureReviewMessage } from "../../src/features/review/reviewCard.js";

class FakeMessage {
  public edits: Array<{ embeds?: unknown[]; components?: unknown[] }> = [];
  public payloads: Array<{ embeds?: unknown[]; components?: unknown[]; content?: string }> = [];
  constructor(public id: string, public channelId: string) {}
  async edit(payload: { embeds?: unknown[]; components?: unknown[] }) {
    this.edits.push(payload);
    return this;
  }
}

class FakeTextChannel {
  public sent: FakeMessage[] = [];
  public messages = {
    fetch: vi.fn(async (messageId: string) => {
      const found = this.sent.find((msg) => msg.id === messageId);
      if (!found) throw new Error("Message not found");
      return found;
    }),
  };
  constructor(public id: string) {}
  isTextBased() {
    return true;
  }
  get type() {
    return ChannelType.GuildText;
  }
  async send(payload: { embeds?: unknown[]; components?: unknown[]; content?: string }) {
    const message = new FakeMessage(`msg-${this.sent.length + 1}`, this.id);
    message.payloads.push(payload);
    this.sent.push(message);
    return message;
  }
}

class FakeClient {
  public users = {
    fetch: vi.fn(async () => ({
      id: "applicant",
      username: "Applicant",
      discriminator: "1234",
      displayAvatarURL: () => "https://example.com/avatar.png",
    })),
  };
  constructor(private channel: FakeTextChannel) {}
  public channels = {
    fetch: vi.fn(async () => this.channel),
  };
}

beforeAll(() => {
  db.exec(`
    CREATE TABLE guild_config (
      guild_id TEXT PRIMARY KEY,
      review_channel_id TEXT,
      gate_channel_id TEXT,
      unverified_channel_id TEXT,
      general_channel_id TEXT,
      accepted_role_id TEXT,
      reviewer_role_id TEXT,
      image_search_url_template TEXT NOT NULL DEFAULT 'https://lens.google.com/uploadbyurl?url={avatarUrl}',
      avatar_scan_enabled INTEGER NOT NULL DEFAULT 0,
      avatar_scan_nsfw_threshold REAL NOT NULL DEFAULT 0.60,
      avatar_scan_skin_edge_threshold REAL NOT NULL DEFAULT 0.18,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE application (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      submitted_at TEXT,
      resolved_at TEXT,
      resolver_id TEXT,
      resolution_reason TEXT
    );
    CREATE TABLE application_response (
      app_id TEXT NOT NULL,
      q_index INTEGER NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (app_id, q_index)
    );
    CREATE TABLE review_action (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id TEXT,
      moderator_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT,
      message_link TEXT,
      meta TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE modmail_bridge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'open'
    );
    CREATE TABLE review_card (
      app_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE avatar_scan (
      application_id TEXT PRIMARY KEY,
      avatar_url TEXT NOT NULL,
      nsfw_score REAL,
      skin_edge_score REAL,
      flagged INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT 'none',
      scanned_at TEXT NOT NULL
    );
  `);
});

beforeEach(() => {
  db.exec(`
    DELETE FROM review_card;
    DELETE FROM avatar_scan;
    DELETE FROM review_action;
    DELETE FROM modmail_bridge;
    DELETE FROM application_response;
    DELETE FROM application;
    DELETE FROM guild_config;
  `);
  db.prepare("INSERT INTO guild_config (guild_id, review_channel_id, avatar_scan_enabled) VALUES (?, ?, 0)").run("guild-1", "review-1");
  db.prepare(
    `
    INSERT INTO application (id, guild_id, user_id, status, submitted_at)
    VALUES ('app-1', 'guild-1', 'applicant', 'submitted', datetime('now'))
  `
  ).run();
  db.prepare(
    `
    INSERT INTO application_response (app_id, q_index, question, answer)
    VALUES ('app-1', 0, 'Why join?', 'Because I like it')
  `
  ).run();
});

describe("ensureReviewMessage", () => {
  it("creates and updates a single review card message", async () => {
    const channel = new FakeTextChannel("review-1");
    const client = new FakeClient(channel);

    const first = await ensureReviewMessage(client as unknown as Client, "app-1");
    expect(first.channelId).toBe("review-1");
    expect(channel.sent).toHaveLength(1);
    expect(channel.messages.fetch).not.toHaveBeenCalled();

    const mapping = db
      .prepare("SELECT message_id FROM review_card WHERE app_id = 'app-1'")
      .get() as { message_id: string };
    expect(mapping.message_id).toBe(channel.sent[0].id);

    await ensureReviewMessage(client as unknown as Client, "app-1");
    expect(channel.sent).toHaveLength(1);
    expect(channel.messages.fetch).toHaveBeenCalledWith(channel.sent[0].id);
    expect(channel.sent[0].edits).toHaveLength(1);
  });

  it("includes avatar risk info when flagged", async () => {
    const channel = new FakeTextChannel("review-1");
    const client = new FakeClient(channel);
    db.prepare(
      "INSERT INTO avatar_scan (application_id, avatar_url, nsfw_score, skin_edge_score, flagged, reason, scanned_at) VALUES (?, ?, ?, ?, 1, ?, datetime('now'))"
    ).run("app-1", "https://example.com/avatar.png", 0.82, 0.35, "both");

    await ensureReviewMessage(client as unknown as Client, "app-1");
    const payload = channel.sent[0]?.payloads[0];
    const embedJson = payload?.embeds?.[0]?.toJSON?.();
    const riskField = embedJson?.fields?.find((field: { name: string }) => field.name === "Avatar Risk");
    expect(riskField?.value).toMatch(/NSFW .*0\.82/);
    expect(riskField?.value).toMatch(/Edge .*0\.35/);

    const rows = payload?.components ?? [];
    const viewRow = rows[1]?.toJSON?.();
    expect(viewRow?.components?.[0]?.custom_id).toBe("v1:avatar:viewsrc:appapp-1");
  });
});
