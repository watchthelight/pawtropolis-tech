// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/features/welcomeBatchShutdown.test.ts
 * WHAT: flushAllSessions sends buffered batch welcomes on shutdown.
 * WHY: The session buffer is in memory, so a restart silently dropped queued welcomes.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  postWelcome: vi.fn(),
  postBatch: vi.fn(),
  getConfig: vi.fn(),
}));

vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/features/welcome.js", () => ({
  postWelcomeCard: h.postWelcome,
  postBatchWelcomeCard: h.postBatch,
}));
vi.mock("../../src/lib/config.js", () => ({ getConfig: h.getConfig }));

import {
  addMember,
  cancelSession,
  flushAllSessions,
  getSessionStatus,
} from "../../src/features/welcomeBatch.js";

function member(id: string, guild: { id: string }) {
  return { id, guild } as never;
}

describe("flushAllSessions", () => {
  const guild = { id: "g1", memberCount: 10 };
  const client = { guilds: { cache: new Map([["g1", guild]]) } } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    cancelSession("g1");
    h.postWelcome.mockResolvedValue(undefined);
    h.postBatch.mockResolvedValue(undefined);
    h.getConfig.mockReturnValue({ general_channel_id: "chan" });
  });

  it("posts the buffered welcomes and closes the session", async () => {
    addMember(member("u1", guild), "mod", vi.fn());
    addMember(member("u2", guild), "mod", vi.fn());

    await flushAllSessions(client);

    expect(h.postBatch).toHaveBeenCalledTimes(1);
    expect(getSessionStatus("g1").active).toBe(false);
  });

  it("does nothing when no session is open", async () => {
    await flushAllSessions(client);

    expect(h.postBatch).not.toHaveBeenCalled();
    expect(h.postWelcome).not.toHaveBeenCalled();
  });

  it("leaves the session alone when the guild has no general channel", async () => {
    h.getConfig.mockReturnValue({ general_channel_id: null });
    addMember(member("u1", guild), "mod", vi.fn());

    await flushAllSessions(client);

    expect(h.postWelcome).not.toHaveBeenCalled();
    cancelSession("g1");
  });
});
