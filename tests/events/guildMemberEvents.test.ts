// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/events/guildMemberEvents.test.ts
 * WHAT: guildMemberAdd / guildMemberRemove resilience.
 * WHY: A failing log-channel send used to abort the rest of the handler, and leavers
 *      without a submitted application skipped verify-thread cleanup.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  logAction: vi.fn(),
  openThread: vi.fn(),
  cleanupThread: vi.fn(),
  trackJoin: vi.fn(),
  trackLeave: vi.fn(),
  pendingApps: [] as Array<{ id: string }>,
  ensureReview: vi.fn(),
}));

vi.mock("../../src/logging/pretty.js", () => ({ logActionPretty: h.logAction }));
vi.mock("../../src/features/gate/threadGate.js", () => ({
  handleMemberJoin: h.openThread,
  cleanupVerifyThreadForUser: h.cleanupThread,
}));
vi.mock("../../src/features/activityTracker.js", () => ({
  trackJoin: h.trackJoin,
  trackLeave: h.trackLeave,
}));
vi.mock("../../src/features/review/card.js", () => ({ ensureReviewMessage: h.ensureReview }));
vi.mock("../../src/features/avatarNsfwMonitor.js", () => ({
  handleMemberJoin: vi.fn(),
  handleAvatarChange: vi.fn(),
}));
vi.mock("../../src/features/inviteTracker.js", () => ({
  trackMemberInvite: vi.fn(),
  handleInviteCreate: vi.fn(),
  handleInviteDelete: vi.fn(),
}));
vi.mock("../../src/features/roleSnapshot.js", () => ({
  snapshotMemberRoles: vi.fn(() => null),
  classifyRemoval: vi.fn(),
}));
vi.mock("../../src/features/gate/dmVerification.js", () => ({ cleanupSession: vi.fn() }));
vi.mock("../../src/lib/userCache.js", () => ({ cacheUser: vi.fn() }));
vi.mock("../../src/web/notifyDashboard.js", () => ({ notifyDashboard: vi.fn() }));
vi.mock("../../src/db/db.js", () => ({
  db: {
    transaction: (fn: unknown) => fn,
    exec: vi.fn(),
    pragma: vi.fn(() => []),
    prepare: vi.fn((sql: string) => ({
      all: () => (sql.includes("FROM application") ? h.pendingApps : []),
      run: () => ({ changes: 0 }),
      get: () => undefined,
    })),
  },
}));

import { registerGuildEvents } from "../../src/events/guildEvents.js";

type Handler = (...args: unknown[]) => Promise<void>;
const handlers: Record<string, Handler> = {};
const client = {
  on: (name: string, fn: Handler) => {
    handlers[name] = fn;
  },
};

const member = {
  id: "u1",
  user: { id: "u1" },
  joinedTimestamp: 1000,
  guild: { id: "g1" },
};

beforeEach(() => {
  vi.clearAllMocks();
  h.pendingApps = [];
  h.logAction.mockResolvedValue(undefined);
  h.openThread.mockResolvedValue(undefined);
  h.cleanupThread.mockResolvedValue(undefined);
  registerGuildEvents(client as never);
});

describe("guildMemberAdd", () => {
  it("still tracks the join and opens the verify thread when the log send throws", async () => {
    h.logAction.mockRejectedValue(new Error("log channel unavailable"));

    await handlers.guildMemberAdd(member);

    expect(h.trackJoin).toHaveBeenCalledWith("g1", "u1", 1);
    expect(h.openThread).toHaveBeenCalledWith(member);
  });
});

describe("guildMemberRemove", () => {
  it("still tracks the leave and refreshes review cards when the log send throws", async () => {
    h.logAction.mockRejectedValue(new Error("log channel unavailable"));
    h.pendingApps = [{ id: "app1" }];

    await handlers.guildMemberRemove(member);

    expect(h.trackLeave).toHaveBeenCalledWith("g1", "u1");
    expect(h.ensureReview).toHaveBeenCalledWith(client, "app1");
  });

  it("cleans up the verify thread for a leaver with no submitted application", async () => {
    h.pendingApps = [];

    await handlers.guildMemberRemove(member);

    expect(h.ensureReview).not.toHaveBeenCalled();
    expect(h.cleanupThread).toHaveBeenCalledWith(client, "g1", "u1", "left_server");
  });

  it("refreshes review cards and cleans up for a leaver with a submitted application", async () => {
    h.pendingApps = [{ id: "app1" }];

    await handlers.guildMemberRemove(member);

    expect(h.ensureReview).toHaveBeenCalledWith(client, "app1");
    expect(h.cleanupThread).toHaveBeenCalledWith(client, "g1", "u1", "left_server");
  });
});
