// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/features/tickets/service.create.test.ts
 * WHAT: TicketService.create when the greeting send fails, and the open-ticket lookup.
 * WHY: A failed greeting send used to make the whole open fail although the channel and
 *      ticket row already existed. The lookup backs the one open ticket per type rule.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

const h = vi.hoisted(() => ({ db: null as any }));

vi.mock("../../../src/db/db.js", () => ({
  get db() {
    return h.db;
  },
}));
vi.mock("../../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../../src/web/notifyDashboard.js", () => ({ notifyDashboard: vi.fn() }));
vi.mock("../../../src/features/tickets/config.js", () => ({ getTicketsCategoryId: () => "cat" }));
vi.mock("../../../src/features/tickets/counters.js", () => ({ allocateNextNumber: () => 7 }));
vi.mock("../../../src/features/tickets/permissions.js", () => ({
  buildTicketOverwrites: () => [],
}));
vi.mock("../../../src/features/tickets/registry.js", () => ({
  getTicketType: () => ({
    key: "support",
    isActive: true,
    numCounterKey: "support",
    channelNameTemplate: "support-{n}",
    permTemplate: { roles: [] },
    pingRoleIds: [],
    hasStaffThread: false,
  }),
}));
vi.mock("../../../src/features/tickets/rendering.js", () => ({
  buildGreetingActionRow: () => ({}),
  buildGreetingEmbed: () => ({}),
  formatChannelName: () => "support-0007",
  resolveMemberIdentity: vi.fn().mockResolvedValue(null),
}));

import { TicketService } from "../../../src/features/tickets/service.js";

function makeGuild(send: ReturnType<typeof vi.fn>) {
  const channel = { id: "chan1", send, delete: vi.fn() };
  return { id: "g1", channels: { create: vi.fn().mockResolvedValue(channel) } };
}

h.db = new Database(":memory:");
h.db.exec(`
    CREATE TABLE ticket (
      id TEXT PRIMARY KEY, type_key TEXT NOT NULL, number INTEGER NOT NULL,
      channel_id TEXT NOT NULL UNIQUE, staff_thread_id TEXT, guild_id TEXT NOT NULL,
      opener_user_id TEXT NOT NULL, claimed_by_user_id TEXT, status TEXT NOT NULL,
      close_reason TEXT, closed_by_user_id TEXT, archive_path TEXT, legacy_source TEXT,
      opened_at INTEGER NOT NULL, claimed_at INTEGER, closed_at INTEGER, greeting_message_id TEXT
    );
    CREATE TABLE ticket_event (
      id INTEGER PRIMARY KEY, ticket_id TEXT, event_type TEXT, actor_user_id TEXT,
      payload_json TEXT, created_at INTEGER
    );
  `);

beforeEach(() => {
  h.db.exec("DELETE FROM ticket; DELETE FROM ticket_event;");
});

describe("TicketService.create", () => {
  it("returns the ticket with greetingFailed when the greeting send throws", async () => {
    const guild = makeGuild(vi.fn().mockRejectedValue(new Error("missing access")));

    const result = await TicketService.create({
      typeKey: "support",
      guild: guild as never,
      openerUserId: "u1",
    });

    expect(result.greetingFailed).toBe(true);
    expect(result.channel.id).toBe("chan1");
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM ticket").get().n).toBe(1);
  });

  it("does not flag a failure when the greeting posts", async () => {
    const guild = makeGuild(vi.fn().mockResolvedValue({ id: "msg1" }));

    const result = await TicketService.create({
      typeKey: "support",
      guild: guild as never,
      openerUserId: "u1",
    });

    expect(result.greetingFailed).toBeUndefined();
    expect(result.ticket.greetingMessageId).toBe("msg1");
  });
});

describe("TicketService.findOpenByOpener", () => {
  it("finds only an open ticket of the same type for the same opener", async () => {
    const guild = makeGuild(vi.fn().mockResolvedValue({ id: "msg1" }));
    const { ticket } = await TicketService.create({
      typeKey: "support",
      guild: guild as never,
      openerUserId: "u1",
    });

    expect(TicketService.findOpenByOpener("g1", "u1", "support")?.id).toBe(ticket.id);
    expect(TicketService.findOpenByOpener("g1", "u2", "support")).toBeNull();
    expect(TicketService.findOpenByOpener("g1", "u1", "other")).toBeNull();
    expect(TicketService.findOpenByOpener("g2", "u1", "support")).toBeNull();

    h.db.prepare("UPDATE ticket SET status = 'closed'").run();
    expect(TicketService.findOpenByOpener("g1", "u1", "support")).toBeNull();
  });
});
