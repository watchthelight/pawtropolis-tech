// SPDX-License-Identifier: LicenseRef-ANW-1.0
import Database from "better-sqlite3";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/db/connection.js", () => {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return { db };
});

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../src/lib/logger.js", () => ({
  logger: loggerMock,
}));

const sentryMock = vi.hoisted(() => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  setContext: vi.fn(),
  setTag: vi.fn(),
}));

vi.mock("../../src/lib/sentry.js", () => sentryMock);

const postErrorCard = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../../src/lib/errorCard.js", () => ({
  postErrorCard: postErrorCard,
}));

import { db } from "../../src/db/connection.js";
import {
  handleReviewButton,
  handleRejectModal,
  handleAvatarViewSourceButton,
  handleAvatarConfirmModal,
} from "../../src/features/review/reviewHandlers.js";

const ensureReviewMessage = vi.hoisted(() => vi.fn());
const approveFlow = vi.hoisted(() => vi.fn());
const rejectFlow = vi.hoisted(() => vi.fn());
const needInfoFlow = vi.hoisted(() => vi.fn());
const kickFlow = vi.hoisted(() => vi.fn());

vi.mock("../../src/features/review/reviewCard.js", () => ({
  ensureReviewMessage,
}));

vi.mock("../../src/features/review/dmAndRoleOps.js", () => ({
  approveFlow,
  rejectFlow,
  needInfoFlow,
  kickFlow,
}));

function createButtonInteraction(appId: string, action: string) {
  const reply = vi.fn().mockResolvedValue(undefined);
  return {
    customId: `v1:decide:${action}:app${appId}`,
    inGuild: () => true,
    guildId: "guild-1",
    guild: { id: "guild-1", channels: { fetch: vi.fn().mockResolvedValue({ id: "review-1" }) } },
    member: {
      permissions: { has: () => true },
      roles: { cache: new Map() },
    },
    user: { id: "mod-1" },
    client: { users: { fetch: vi.fn() } },
    reply,
    showModal: vi.fn().mockResolvedValue(undefined),
  } as unknown as Parameters<typeof handleReviewButton>[0];
}

function insertBaseData(appId: string, status: string) {
  db.prepare(
    "INSERT INTO guild_config (guild_id, review_channel_id, image_search_url_template, avatar_scan_enabled, avatar_scan_nsfw_threshold, avatar_scan_skin_edge_threshold) VALUES (?, ?, ?, ?, ?, ?)"
  ).run("guild-1", "review-1", "https://lens.google.com/uploadbyurl?url={avatarUrl}", 1, 0.6, 0.18);
  db.prepare(
    "INSERT INTO application (id, guild_id, user_id, status, submitted_at) VALUES (?, 'guild-1', 'applicant', ?, datetime('now'))"
  ).run(appId, status);
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
  ensureReviewMessage.mockReset();
  ensureReviewMessage.mockResolvedValue({ channelId: "review-1", messageId: "msg-1" });
  approveFlow.mockReset();
  approveFlow.mockResolvedValue({ roleApplied: true, dmDelivered: true });
  rejectFlow.mockReset();
  rejectFlow.mockResolvedValue({ dmDelivered: true });
  needInfoFlow.mockReset();
  needInfoFlow.mockResolvedValue({ threadId: "thread-1", created: true });
  kickFlow.mockReset();
  kickFlow.mockResolvedValue({ dmDelivered: true, kickSucceeded: true });

  db.exec(`
    DELETE FROM review_action;
    DELETE FROM avatar_scan;
    DELETE FROM application;
    DELETE FROM guild_config;
  `);
});

describe("review handlers", () => {
  it("approves an application and records metadata", async () => {
    insertBaseData("A1", "submitted");
    const interaction = createButtonInteraction("A1", "approve");
    await handleReviewButton(interaction as never);

    const app = db
      .prepare("SELECT status, resolver_id FROM application WHERE id = ?")
      .get("A1") as { status: string; resolver_id: string };
    expect(app.status).toBe("approved");
    expect(app.resolver_id).toBe("mod-1");

    const record = db
      .prepare("SELECT action, meta FROM review_action WHERE app_id = ?")
      .get("A1") as { action: string; meta: string };
    expect(record.action).toBe("approve");
    expect(JSON.parse(record.meta)).toMatchObject({ roleApplied: true, dmDelivered: true });
    expect(approveFlow).toHaveBeenCalledOnce();
    expect(ensureReviewMessage).toHaveBeenCalledWith(interaction.client, "A1");
    expect(interaction.reply).toHaveBeenCalledWith({ ephemeral: true, content: "Application approved." });
  });

  it("rejects via modal submission with reason", async () => {
    insertBaseData("A2", "submitted");
    const button = createButtonInteraction("A2", "reject");
    await handleReviewButton(button as never);
    expect(button.showModal).toHaveBeenCalledOnce();

    const modalReply = vi.fn().mockResolvedValue(undefined);
    const rejectModal = {
      customId: "v1:modal:reject:appA2",
      inGuild: () => true,
      guildId: "guild-1",
      guild: { id: "guild-1", name: "Guild" },
      member: { permissions: { has: () => true }, roles: { cache: new Map() } },
      user: { id: "mod-1" },
      client: { users: { fetch: vi.fn().mockResolvedValue({ id: "applicant" }) } },
      fields: { getTextInputValue: () => "Too short" },
      reply: modalReply,
    };
    await handleRejectModal(rejectModal as never);

    const app = db
      .prepare("SELECT status, resolution_reason FROM application WHERE id = ?")
      .get("A2") as { status: string; resolution_reason: string };
    expect(app.status).toBe("rejected");
    expect(app.resolution_reason).toBe("Too short");

    const record = db
      .prepare("SELECT action, reason, meta FROM review_action WHERE app_id = ?")
      .get("A2") as { action: string; reason: string; meta: string };
    expect(record.action).toBe("reject");
    expect(record.reason).toBe("Too short");
    expect(JSON.parse(record.meta)).toEqual({ dmDelivered: true });
    expect(rejectFlow).toHaveBeenCalledOnce();
    expect(ensureReviewMessage).toHaveBeenCalledWith(rejectModal.client, "A2");
    expect(modalReply).toHaveBeenCalledWith({ ephemeral: true, content: "Application rejected." });
  });

  it("handles need info and avoids duplicate review actions", async () => {
    insertBaseData("A3", "submitted");
    needInfoFlow.mockResolvedValueOnce({ threadId: "thread-1", created: true });
    needInfoFlow.mockResolvedValue({ threadId: "thread-1", created: false });

    const interaction = createButtonInteraction("A3", "needinfo");
    await handleReviewButton(interaction as never);

    let count = db
      .prepare("SELECT COUNT(*) as count FROM review_action WHERE app_id = ?")
      .get("A3") as { count: number };
    expect(count.count).toBe(1);

    const secondInteraction = createButtonInteraction("A3", "needinfo");
    await handleReviewButton(secondInteraction as never);

    count = db
      .prepare("SELECT COUNT(*) as count FROM review_action WHERE app_id = ?")
      .get("A3") as { count: number };
    expect(count.count).toBe(1);
    expect(needInfoFlow).toHaveBeenCalledTimes(2);
    expect(ensureReviewMessage).toHaveBeenCalledTimes(2);
  });

  it("kicks an applicant and records the result", async () => {
    insertBaseData("A4", "submitted");
    const interaction = createButtonInteraction("A4", "kick");
    await handleReviewButton(interaction as never);

    const app = db
      .prepare("SELECT status FROM application WHERE id = ?")
      .get("A4") as { status: string };
    expect(app.status).toBe("kicked");

    const record = db
      .prepare("SELECT action, meta FROM review_action WHERE app_id = ?")
      .get("A4") as { action: string; meta: string };
    expect(record.action).toBe("kick");
    expect(JSON.parse(record.meta)).toMatchObject({ kickSucceeded: true });
    expect(kickFlow).toHaveBeenCalledOnce();
    expect(ensureReviewMessage).toHaveBeenCalledWith(interaction.client, "A4");
  });

  it("ignores repeated approve clicks", async () => {
    insertBaseData("A5", "submitted");
    const first = createButtonInteraction("A5", "approve");
    await handleReviewButton(first as never);
    const second = createButtonInteraction("A5", "approve");
    await handleReviewButton(second as never);

    const count = db
      .prepare("SELECT COUNT(*) as count FROM review_action WHERE app_id = ?")
      .get("A5") as { count: number };
    expect(count.count).toBe(1);
    expect(approveFlow).toHaveBeenCalledTimes(1);
  });

  it("requires 18+ confirmation before showing avatar link", async () => {
    insertBaseData("A6", "submitted");
    db.prepare(
      "INSERT INTO avatar_scan (application_id, avatar_url, nsfw_score, skin_edge_score, flagged, reason, scanned_at) VALUES (?, ?, ?, ?, 1, ?, datetime('now'))"
    ).run("A6", "https://example.com/avatar.png", 0.2, 0.25, "skin_edge");

    const interaction = {
      customId: "v1:avatar:viewsrc:appA6",
      inGuild: () => true,
      guildId: "guild-1",
      guild: { id: "guild-1" },
      member: { permissions: { has: () => true }, roles: { cache: new Map() } },
      user: { id: "mod-1" },
      reply: vi.fn(),
      showModal: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof handleAvatarViewSourceButton>[0];

    await handleAvatarViewSourceButton(interaction);
    expect(interaction.showModal).toHaveBeenCalledTimes(1);

    const modalInteraction = {
      customId: "v1:avatar:confirm18:appA6",
      inGuild: () => true,
      guildId: "guild-1",
      guild: { id: "guild-1" },
      member: { permissions: { has: () => true }, roles: { cache: new Map() } },
      user: { id: "mod-1" },
      fields: { getTextInputValue: () => "nope" },
      reply: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof handleAvatarConfirmModal>[0];

    await handleAvatarConfirmModal(modalInteraction);
    expect(modalInteraction.reply).toHaveBeenCalledWith({ ephemeral: true, content: "No." });
    const count = db
      .prepare("SELECT COUNT(*) as count FROM review_action WHERE action = 'avatar_viewsrc'")
      .get() as { count: number };
    expect(count.count).toBe(0);
  });

  it("returns reverse image link after confirmation", async () => {
    insertBaseData("A7", "submitted");
    db.prepare(
      "INSERT INTO avatar_scan (application_id, avatar_url, nsfw_score, skin_edge_score, flagged, reason, scanned_at) VALUES (?, ?, ?, ?, 1, ?, datetime('now'))"
    ).run("A7", "https://example.com/avatar.png", 0.9, 0.4, "both");

    const modalInteraction = {
      customId: "v1:avatar:confirm18:appA7",
      inGuild: () => true,
      guildId: "guild-1",
      guild: { id: "guild-1", name: "Guild" },
      member: { permissions: { has: () => true }, roles: { cache: new Map() } },
      user: { id: "mod-1" },
      fields: { getTextInputValue: () => "I AM 18+" },
      reply: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof handleAvatarConfirmModal>[0];

    await handleAvatarConfirmModal(modalInteraction);
    expect(modalInteraction.reply).toHaveBeenCalledWith({
      ephemeral: true,
      content: "https://lens.google.com/uploadbyurl?url=https%3A%2F%2Fexample.com%2Favatar.png",
    });

    const record = db
      .prepare("SELECT action, meta FROM review_action WHERE app_id = ? ORDER BY id DESC LIMIT 1")
      .get("A7") as { action: string; meta: string };
    expect(record.action).toBe("avatar_viewsrc");
    expect(record.meta).toContain("viewed_at");
  });
});
