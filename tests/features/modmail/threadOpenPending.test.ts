// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/features/modmail/threadOpenPending.test.ts
 * WHAT: Stale 'pending' guard rows and orphan-thread cleanup in modmail thread open.
 * WHY: A crash between the pending insert and thread registration used to block every
 *      later attempt forever with "being created by another moderator".
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelType } from "discord.js";
import Database from "better-sqlite3";

const h = vi.hoisted(() => ({ db: null as any, ensureMods: vi.fn() }));

vi.mock("../../../src/db/db.js", () => ({
  get db() {
    return h.db;
  },
}));
vi.mock("../../../src/lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../src/lib/sentry.js", () => ({ captureException: vi.fn() }));
vi.mock("../../../src/lib/reqctx.js", () => ({
  enrichEvent: vi.fn(),
  newTraceId: vi.fn(() => "trace-test"),
  ctx: vi.fn(() => ({ traceId: "trace-test" })),
}));
vi.mock("../../../src/lib/ids.js", () => ({ shortCode: vi.fn((id: string) => id.slice(0, 8)) }));
vi.mock("../../../src/lib/config.js", () => ({
  hasManageGuild: vi.fn(() => true),
  isReviewer: vi.fn(() => true),
  canRunAllCommands: vi.fn(() => true),
}));
vi.mock("../../../src/logging/pretty.js", () => ({
  logActionPretty: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../src/lib/constants.js", () => ({ SAFE_ALLOWED_MENTIONS: { parse: [] } }));
vi.mock("../../../src/features/modmail/tickets.js", () => ({ createTicket: vi.fn(() => 123) }));
vi.mock("../../../src/features/modmail/threadState.js", () => ({ addOpenThread: vi.fn() }));
vi.mock("../../../src/features/modmail/threadPerms.js", () => ({
  missingPermsForStartThread: vi.fn(() => []),
  ensureModsCanSpeakInThread: h.ensureMods,
}));
vi.mock("../../../src/web/notifyDashboard.js", () => ({ notifyDashboard: vi.fn() }));

import { openPublicModmailThreadFor } from "../../../src/features/modmail/threadOpen.js";

function makeInteraction() {
  const thread = {
    id: "thread-1",
    type: ChannelType.PublicThread,
    parentId: "chan",
    guildId: "g1",
    autoArchiveDuration: 4320,
    send: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const user = {
    id: "u1",
    username: "applicant",
    tag: "applicant#0",
    createdTimestamp: 1,
    displayAvatarURL: () => "https://cdn.example/a.png",
    send: vi.fn().mockResolvedValue(undefined),
  };
  const channel = {
    id: "chan",
    type: ChannelType.GuildText,
    permissionsFor: vi.fn(),
    threads: { create: vi.fn().mockResolvedValue(thread) },
  };
  const interaction = {
    guildId: "g1",
    guild: { id: "g1", name: "Guild", members: { me: { id: "bot" } } },
    member: { id: "mod" },
    user: { id: "mod" },
    channel,
    client: { users: { fetch: vi.fn().mockResolvedValue(user) } },
  };
  return { interaction, thread };
}

function guardRows() {
  return h.db.prepare("SELECT thread_id FROM open_modmail").all() as Array<{ thread_id: string }>;
}

describe("modmail thread open: pending guard", () => {
  beforeEach(() => {
    h.db = new Database(":memory:");
    h.db.exec(`
      CREATE TABLE open_modmail (
        guild_id TEXT NOT NULL, applicant_id TEXT NOT NULL, thread_id TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        PRIMARY KEY (guild_id, applicant_id)
      );
      CREATE TABLE modmail_ticket (id INTEGER PRIMARY KEY, thread_id TEXT, thread_channel_id TEXT);
      INSERT INTO modmail_ticket (id) VALUES (123);
    `);
    h.ensureMods.mockReset().mockResolvedValue(undefined);
  });

  it("refuses while a recent pending row exists", async () => {
    h.db.prepare("INSERT INTO open_modmail (guild_id, applicant_id, thread_id) VALUES ('g1','u1','pending')").run();
    const { interaction } = makeInteraction();

    const result = await openPublicModmailThreadFor({ interaction: interaction as any, userId: "u1" });

    expect(result.success).toBe(false);
    expect(result.message).toContain("being created by another moderator");
    expect(guardRows()).toEqual([{ thread_id: "pending" }]);
  });

  it("replaces a stale pending row and opens the thread", async () => {
    h.db
      .prepare(
        "INSERT INTO open_modmail (guild_id, applicant_id, thread_id, created_at) VALUES ('g1','u1','pending', strftime('%s','now') - 3600)"
      )
      .run();
    const { interaction } = makeInteraction();

    const result = await openPublicModmailThreadFor({ interaction: interaction as any, userId: "u1" });

    expect(result.success).toBe(true);
    expect(guardRows()).toEqual([{ thread_id: "thread-1" }]);
  });

  it("does not touch a stale row that already has a real thread", async () => {
    h.db
      .prepare(
        "INSERT INTO open_modmail (guild_id, applicant_id, thread_id, created_at) VALUES ('g1','u1','existing', 1)"
      )
      .run();
    const { interaction } = makeInteraction();

    const result = await openPublicModmailThreadFor({ interaction: interaction as any, userId: "u1" });

    expect(result.success).toBe(false);
    expect(result.message).toContain("<#existing>");
  });

  it("removes the pending row and the orphan thread when registration never happens", async () => {
    h.ensureMods.mockRejectedValue(new Error("missing access"));
    const { interaction, thread } = makeInteraction();

    const result = await openPublicModmailThreadFor({ interaction: interaction as any, userId: "u1" });

    expect(result.success).toBe(false);
    expect(guardRows()).toEqual([]);
    expect(thread.delete).toHaveBeenCalledTimes(1);
  });
});
