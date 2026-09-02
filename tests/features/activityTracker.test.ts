/**
 * Pawtropolis Tech — tests/features/activityTracker.test.ts
 * WHAT: Unit tests for activity tracking module (Silent-Since-Join flagger).
 * WHY: Verify join tracking, first message tracking, and threshold evaluation by
 *      driving the REAL exported functions and asserting on the SQL/params handed
 *      to the db boundary and the side effects at the discord.js boundary.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// db boundary mock
// ---------------------------------------------------------------------------
// Each db.prepare(sql) call is recorded with its SQL text and a fresh statement
// object whose .run/.get capture the bound params. This lets tests assert on the
// EXACT SQL and params the real module sends, instead of re-deriving them.
const { mockPrepare, prepareCalls, getRowQueue, getDefault, runThrows } = vi.hoisted(() => {
  const prepareCalls: Array<{ sql: string; runArgs?: unknown[]; getArgs?: unknown[] }> = [];
  // Queue of rows to return from successive .get() calls. Falls back to getDefault.
  const getRowQueue: unknown[] = [];
  const getDefault = { value: undefined as unknown };
  // When set, .run() throws this error (to exercise graceful-failure paths).
  const runThrows = { error: null as Error | null };

  const mockPrepare = vi.fn((sql: string) => {
    const call: { sql: string; runArgs?: unknown[]; getArgs?: unknown[] } = { sql };
    prepareCalls.push(call);
    return {
      run: (...args: unknown[]) => {
        call.runArgs = args;
        if (runThrows.error) throw runThrows.error;
        return { changes: 1 };
      },
      get: (...args: unknown[]) => {
        call.getArgs = args;
        return getRowQueue.length > 0 ? getRowQueue.shift() : getDefault.value;
      },
    };
  });

  return { mockPrepare, prepareCalls, getRowQueue, getDefault, runThrows };
});

vi.mock("../../src/db/db.js", () => ({
  db: { prepare: mockPrepare },
}));

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/lib/logger.js", () => ({ logger: mockLogger }));

// Config getter mock: tests override the return per case.
const { mockGetFlaggerConfig } = vi.hoisted(() => ({
  mockGetFlaggerConfig: vi.fn(() => ({ channelId: null as string | null, silentDays: 7 })),
}));

vi.mock("../../src/config/flaggerStore.js", () => ({
  getFlaggerConfig: mockGetFlaggerConfig,
}));

vi.mock("../../src/features/logger.js", () => ({
  getLoggingChannel: vi.fn().mockResolvedValue(null),
}));

// The flag embed builder needs a real discord.js User; we never want to build a
// real embed in a unit test, so mock the boundary and assert it was called.
const { mockBuildFlagEmbed } = vi.hoisted(() => ({
  mockBuildFlagEmbed: vi.fn(() => ({ __embed: true })),
}));

vi.mock("../../src/logging/embeds.js", () => ({
  buildFlagEmbedSilentFirstMsg: mockBuildFlagEmbed,
}));

import {
  trackJoin,
  trackLeave,
  trackFirstMessage,
  _resetFirstMessageCacheForTests,
} from "../../src/features/activityTracker.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetDbState(): void {
  prepareCalls.length = 0;
  getRowQueue.length = 0;
  getDefault.value = undefined;
  runThrows.error = null;
}

/** Find the recorded prepare() call whose SQL contains every given fragment. */
function findPrepare(...fragments: string[]) {
  return prepareCalls.find((c) => fragments.every((f) => c.sql.includes(f)));
}

/**
 * Build a fake discord.js Client whose flags channel accepts a send. Returns the
 * client plus the channel.send spy so callers can assert an alert was posted.
 */
function makeFlaggingClient(opts: { channelId: string } = { channelId: "flags-chan" }) {
  const send = vi.fn().mockResolvedValue(undefined);
  const channel = {
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    send,
  };
  const guild = {
    channels: { fetch: vi.fn().mockResolvedValue(channel) },
    members: { fetchMe: vi.fn().mockResolvedValue({ id: "bot" }) },
  };
  const client = {
    guilds: { fetch: vi.fn().mockResolvedValue(guild) },
    users: { fetch: vi.fn().mockResolvedValue({ id: "user456", tag: "user#0001" }) },
  };
  return { client: client as unknown as import("discord.js").Client, send, opts };
}

/** Build a fake discord.js Message for trackFirstMessage. */
function makeMessage(over: Partial<{
  guildId: string | null;
  authorId: string;
  bot: boolean;
  createdTimestamp: number;
  channelId: string;
  id: string;
}> = {}) {
  return {
    guildId: over.guildId === undefined ? "guild123" : over.guildId,
    author: { id: over.authorId ?? "user456", bot: over.bot ?? false },
    createdTimestamp: over.createdTimestamp ?? 1700604800000, // ms
    channelId: over.channelId ?? "chan789",
    id: over.id ?? "msg789",
  } as unknown as import("discord.js").Message;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDbState();
  _resetFirstMessageCacheForTests();
  mockGetFlaggerConfig.mockReturnValue({ channelId: null, silentDays: 7 });
});

// ---------------------------------------------------------------------------
// trackJoin (original first block, preserved)
// ---------------------------------------------------------------------------

describe("features/activityTracker", () => {
  describe("trackJoin", () => {
    it("inserts join record into user_activity table", () => {
      trackJoin("guild123", "user456", 1700000000);

      expect(mockPrepare).toHaveBeenCalled();
      const call = findPrepare("INSERT INTO user_activity");
      expect(call).toBeDefined();
      expect(call?.runArgs).toEqual(["guild123", "user456", 1700000000]);
    });

    it("handles missing table error gracefully", () => {
      runThrows.error = new Error("no such table: user_activity");

      expect(() => trackJoin("guild123", "user456", 1700000000)).not.toThrow();
      // Missing-table is treated as benign: debug log, no warn.
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it("handles other database errors gracefully", () => {
      runThrows.error = new Error("Database error");

      expect(() => trackJoin("guild123", "user456", 1700000000)).not.toThrow();
      // A non-table error is logged as a warning (still non-throwing).
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// trackJoin UPSERT SQL (driven through the real function)
// ---------------------------------------------------------------------------

describe("trackJoin UPSERT SQL", () => {
  it("uses an INSERT ... ON CONFLICT DO UPDATE upsert", () => {
    trackJoin("g", "u", 1700000000);

    const call = findPrepare("INSERT INTO user_activity");
    expect(call).toBeDefined();
    const sql = call!.sql;
    expect(sql).toContain("ON CONFLICT(guild_id, user_id)");
    expect(sql).toContain("DO UPDATE SET");
    expect(sql).toContain("joined_at = excluded.joined_at");
  });

  it("clears left_at on conflict so a rejoin is no longer marked as left", () => {
    // This is the exact clause the old literal-only test was missing. If the
    // module dropped `left_at = NULL`, this assertion would fail.
    trackJoin("g", "u", 1700000000);

    const call = findPrepare("INSERT INTO user_activity");
    expect(call).toBeDefined();
    expect(call!.sql).toMatch(/left_at\s*=\s*NULL/);
  });

  it("binds guildId, userId, joinedAt in order to the upsert", () => {
    trackJoin("guildABC", "userXYZ", 1712345678);

    const call = findPrepare("INSERT INTO user_activity");
    expect(call?.runArgs).toEqual(["guildABC", "userXYZ", 1712345678]);
  });
});

// ---------------------------------------------------------------------------
// trackLeave (real function)
// ---------------------------------------------------------------------------

describe("trackLeave", () => {
  it("issues an UPDATE that sets left_at for the guild/user", () => {
    trackLeave("guild123", "user456");

    const call = findPrepare("UPDATE user_activity", "left_at = ?");
    expect(call).toBeDefined();
    // Params: [now_seconds, guildId, userId]. now is derived from Date.now().
    expect(call!.runArgs).toHaveLength(3);
    expect(call!.runArgs?.[1]).toBe("guild123");
    expect(call!.runArgs?.[2]).toBe("user456");
    expect(typeof call!.runArgs?.[0]).toBe("number");
  });

  it("swallows missing-table / missing-column errors without warning", () => {
    runThrows.error = new Error("no such column: left_at");

    expect(() => trackLeave("guild123", "user456")).not.toThrow();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("warns on other errors but does not throw", () => {
    runThrows.error = new Error("disk I/O error");

    expect(() => trackLeave("guild123", "user456")).not.toThrow();
    expect(mockLogger.warn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// trackFirstMessage early-exit guards (real function)
// ---------------------------------------------------------------------------

describe("trackFirstMessage guards", () => {
  it("ignores DMs (no guildId) without touching the db", async () => {
    const { client } = makeFlaggingClient();
    await trackFirstMessage(client, makeMessage({ guildId: null }));

    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it("ignores bot authors without touching the db", async () => {
    const { client } = makeFlaggingClient();
    await trackFirstMessage(client, makeMessage({ bot: true }));

    expect(mockPrepare).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// trackFirstMessage row paths (real function)
// ---------------------------------------------------------------------------

describe("trackFirstMessage row handling", () => {
  it("inserts a fallback row (joined_at = message ts) when user is unknown", async () => {
    const { client } = makeFlaggingClient();
    getDefault.value = undefined; // SELECT finds nothing

    await trackFirstMessage(
      client,
      makeMessage({ createdTimestamp: 1700604800000, channelId: "c", id: "m" })
    );

    // SELECT issued for the existing row.
    expect(findPrepare("SELECT joined_at, first_message_at")).toBeDefined();
    // Fallback INSERT writes both joined_at and first_message_at = message seconds.
    const ins = findPrepare("INSERT INTO user_activity", "first_message_at");
    expect(ins).toBeDefined();
    expect(ins!.runArgs).toEqual(["guild123", "user456", 1700604800, 1700604800]);
    // No threshold evaluation for unknown joins => no config lookup.
    expect(mockGetFlaggerConfig).not.toHaveBeenCalled();
  });

  it("skips when first_message_at is already recorded", async () => {
    const { client } = makeFlaggingClient();
    getDefault.value = { joined_at: 1700000000, first_message_at: 1700100000 };

    await trackFirstMessage(client, makeMessage());

    // Only the SELECT runs; no UPDATE of first_message_at, no flag evaluation.
    expect(findPrepare("SELECT joined_at, first_message_at")).toBeDefined();
    expect(findPrepare("UPDATE", "first_message_at = ?")).toBeUndefined();
    expect(mockGetFlaggerConfig).not.toHaveBeenCalled();
  });

  it("records first_message_at and converts the Discord ms timestamp to seconds", async () => {
    const { client } = makeFlaggingClient();
    // Existing join row, no first message yet. Channel unconfigured so we exit
    // right after the UPDATE (no flag side effects).
    getDefault.value = { joined_at: 1700000000, first_message_at: null };
    mockGetFlaggerConfig.mockReturnValue({ channelId: null, silentDays: 7 });

    await trackFirstMessage(client, makeMessage({ createdTimestamp: 1700604800000 }));

    const upd = findPrepare("UPDATE", "first_message_at = ?");
    expect(upd).toBeDefined();
    // 1700604800000 ms => 1700604800 s, then guildId, userId.
    expect(upd!.runArgs).toEqual([1700604800, "guild123", "user456"]);
  });
});

// ---------------------------------------------------------------------------
// Silent-days threshold via evaluateAndFlag (driven through trackFirstMessage)
// ---------------------------------------------------------------------------
// evaluateAndFlag is not exported; we exercise it through trackFirstMessage.
// The observable signal of "flagged" is the write of flagged_at / flagged_reason
// and the channel.send of the alert embed.

describe("silent-days threshold (evaluateAndFlag)", () => {
  const joinedAt = 1700000000;
  const SEVEN_DAYS = 7 * 86400;

  function runWithDelta(deltaSeconds: number, silentDays: number) {
    const { client, send } = makeFlaggingClient();
    getDefault.value = { joined_at: joinedAt, first_message_at: null };
    mockGetFlaggerConfig.mockReturnValue({ channelId: "flags-chan", silentDays });
    const message = makeMessage({ createdTimestamp: (joinedAt + deltaSeconds) * 1000 });
    return { client, send, message };
  }

  it("does NOT flag when silent days are below the threshold", async () => {
    // 6 days 23:59:59 of silence, threshold 7 => below.
    const { client, send, message } = runWithDelta(SEVEN_DAYS - 1, 7);

    await trackFirstMessage(client, message);

    expect(mockGetFlaggerConfig).toHaveBeenCalledWith("guild123");
    expect(send).not.toHaveBeenCalled();
    expect(findPrepare("UPDATE", "flagged_at = ?")).toBeUndefined();
  });

  it("flags when silent days exactly meet the threshold (>= boundary)", async () => {
    // Exactly 7 full days, threshold 7 => meets boundary, must flag.
    const { client, send, message } = runWithDelta(SEVEN_DAYS, 7);

    await trackFirstMessage(client, message);

    expect(send).toHaveBeenCalledTimes(1);
    expect(mockBuildFlagEmbed).toHaveBeenCalledTimes(1);
    const flagUpdate = findPrepare("UPDATE", "flagged_at = ?", "flagged_reason");
    expect(flagUpdate).toBeDefined();
    // Params: [firstMessageAt, reason, guildId, userId]. silentDays === 7.
    expect(flagUpdate!.runArgs?.[1]).toBe("Silent for 7 days before first message");
    expect(flagUpdate!.runArgs?.[2]).toBe("guild123");
    expect(flagUpdate!.runArgs?.[3]).toBe("user456");
  });

  it("flags when silent days exceed the threshold", async () => {
    // 10 days of silence, threshold 7 => exceed.
    const { client, send, message } = runWithDelta(10 * 86400, 7);

    await trackFirstMessage(client, message);

    expect(send).toHaveBeenCalledTimes(1);
    const flagUpdate = findPrepare("UPDATE", "flagged_at = ?", "flagged_reason");
    expect(flagUpdate?.runArgs?.[1]).toBe("Silent for 10 days before first message");
  });

  it("respects a custom (higher) threshold: 10 silent days is below a 14-day threshold", async () => {
    // If the comparison were flipped to `>` or the operand swapped, this would flag.
    const { client, send, message } = runWithDelta(10 * 86400, 14);

    await trackFirstMessage(client, message);

    expect(send).not.toHaveBeenCalled();
    expect(findPrepare("UPDATE", "flagged_at = ?")).toBeUndefined();
  });

  it("skips evaluation entirely when no flags channel is configured", async () => {
    const { client, send } = makeFlaggingClient();
    getDefault.value = { joined_at: joinedAt, first_message_at: null };
    mockGetFlaggerConfig.mockReturnValue({ channelId: null, silentDays: 7 });
    const message = makeMessage({ createdTimestamp: (joinedAt + 30 * 86400) * 1000 });

    await trackFirstMessage(client, message);

    // first_message_at still recorded, but no flag despite 30 silent days.
    expect(findPrepare("UPDATE", "first_message_at = ?")).toBeDefined();
    expect(send).not.toHaveBeenCalled();
    expect(findPrepare("UPDATE", "flagged_at = ?")).toBeUndefined();
  });
});
