/**
 * Pawtropolis Tech — tests/features/modmail/threadClose.test.ts
 * WHAT: Unit tests for modmail thread closing module.
 * WHY: Verify thread closing, transcript flushing, and cleanup logic.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted for mock functions
const { mockGet, mockRun, mockPrepare, mockTransaction } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockRun: vi.fn(),
  mockPrepare: vi.fn(),
  mockTransaction: vi.fn((fn: Function) => fn),
}));

mockPrepare.mockReturnValue({
  get: mockGet,
  run: mockRun,
});

vi.mock("../../../src/db/db.js", () => ({
  db: {
    prepare: mockPrepare,
    transaction: mockTransaction,
  },
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../src/lib/sentry.js", () => ({
  captureException: vi.fn(),
}));

vi.mock("../../../src/lib/reqctx.js", () => ({
  enrichEvent: vi.fn(),
}));

vi.mock("../../../src/lib/config.js", () => ({
  getConfig: vi.fn(() => ({
    modmail_log_channel_id: "log123",
    modmail_delete_on_close: true,
  })),
}));

vi.mock("../../../src/logging/pretty.js", () => ({
  logActionPretty: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/lib/constants.js", () => ({
  SAFE_ALLOWED_MENTIONS: { parse: [] },
}));

vi.mock("../../../src/web/notifyDashboard.js", () => ({
  notifyDashboard: vi.fn(),
}));

vi.mock("../../../src/features/modmail/tickets.js", () => ({
  getOpenTicketByUser: vi.fn(),
  getTicketByThread: vi.fn(),
  getTicketById: vi.fn(),
  // closeTicket returns the number of rows changed. Default to 1 (claim won) so
  // tests that drive past the atomic close gate work without per-test setup.
  closeTicket: vi.fn(() => 1),
}));

vi.mock("../../../src/features/modmail/transcript.js", () => ({
  flushTranscript: vi.fn().mockResolvedValue({ messageId: "msg123", lineCount: 10 }),
  getTranscriptBuffer: vi.fn(() => undefined),
  formatTranscript: vi.fn(() => "STAFF: hi\nUSER: hello"),
}));

vi.mock("../../../src/features/modmail/threadState.js", () => ({
  OPEN_MODMAIL_THREADS: new Set(),
  removeOpenThread: vi.fn(),
}));

// Dynamic imports inside the source (review card refresh). Stub so the
// best-effort refresh path is a no-op and does not pull real modules.
vi.mock("../../../src/features/review.js", () => ({
  ensureReviewMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/features/appLookup.js", () => ({
  findAppByShortCode: vi.fn(() => null),
}));

import { closeModmailThread, closeModmailForApplication } from "../../../src/features/modmail/threadClose.js";
import {
  getTicketById,
  getTicketByThread,
  getOpenTicketByUser,
  closeTicket,
} from "../../../src/features/modmail/tickets.js";
import { getConfig } from "../../../src/lib/config.js";
import {
  getTranscriptBuffer,
  flushTranscript,
  formatTranscript,
} from "../../../src/features/modmail/transcript.js";

const mockGetTicketById = getTicketById as ReturnType<typeof vi.fn>;
const mockGetTicketByThread = getTicketByThread as ReturnType<typeof vi.fn>;
const mockGetOpenTicketByUser = getOpenTicketByUser as ReturnType<typeof vi.fn>;
const mockCloseTicket = closeTicket as ReturnType<typeof vi.fn>;
const mockGetConfig = getConfig as ReturnType<typeof vi.fn>;
const mockGetTranscriptBuffer = getTranscriptBuffer as ReturnType<typeof vi.fn>;
const mockFlushTranscript = flushTranscript as ReturnType<typeof vi.fn>;
const mockFormatTranscript = formatTranscript as ReturnType<typeof vi.fn>;

// Global vitest config sets restoreMocks + clearMocks, which wipes mock
// implementations before every test. Centralize the defaults the source needs
// so each describe's beforeEach can re-apply them.
function applyModmailMockDefaults() {
  mockPrepare.mockReturnValue({ get: mockGet, run: mockRun });
  // better-sqlite3 `db.transaction(fn)` returns a wrapped FUNCTION; the source
  // calls it immediately as `db.transaction(fn)()`. Return fn (not fn()) so the
  // callback runs when invoked, matching the real calling convention.
  mockTransaction.mockImplementation((fn: Function) => fn);
  // closeTicket claims the close (1 row changed) by default.
  mockCloseTicket.mockReturnValue(1);
  mockGetTranscriptBuffer.mockReturnValue(undefined);
  mockFlushTranscript.mockResolvedValue({ messageId: "msg123", lineCount: 10 });
  mockFormatTranscript.mockReturnValue("STAFF: hi\nUSER: hello");
  mockGetConfig.mockReturnValue({
    modmail_log_channel_id: "log123",
    modmail_delete_on_close: true,
  });
}

describe("features/modmail/threadClose", () => {
  beforeEach(() => {
    applyModmailMockDefaults();
  });

  describe("closeModmailThread", () => {
    describe("ticket lookup", () => {
      it("looks up by ticketId when provided", async () => {
        mockGetTicketById.mockReturnValue(null);

        const interaction = {
          guildId: "guild123",
          channel: { isThread: () => false },
        };

        const result = await closeModmailThread({
          interaction: interaction as any,
          ticketId: 123,
        });

        expect(mockGetTicketById).toHaveBeenCalledWith(123);
        expect(result.success).toBe(false);
        expect(result.message).toBe("Modmail ticket not found.");
      });

      it("looks up by threadId when provided", async () => {
        mockGetTicketByThread.mockReturnValue(null);

        const interaction = {
          guildId: "guild123",
          channel: { isThread: () => false },
        };

        const result = await closeModmailThread({
          interaction: interaction as any,
          threadId: "thread123",
        });

        expect(mockGetTicketByThread).toHaveBeenCalledWith("thread123");
        expect(result.success).toBe(false);
      });

      it("uses current channel if no ID provided and in thread", async () => {
        mockGetTicketByThread.mockReturnValue(null);

        const interaction = {
          guildId: "guild123",
          channel: {
            isThread: () => true,
            id: "current-thread",
          },
        };

        const result = await closeModmailThread({
          interaction: interaction as any,
        });

        expect(mockGetTicketByThread).toHaveBeenCalledWith("current-thread");
      });
    });

    describe("ticket status checks", () => {
      it("rejects when ticket not found", async () => {
        mockGetTicketById.mockReturnValue(null);

        const interaction = {
          guildId: "guild123",
          channel: { isThread: () => false },
        };

        const result = await closeModmailThread({
          interaction: interaction as any,
          ticketId: 999,
        });

        expect(result.success).toBe(false);
        expect(result.message).toBe("Modmail ticket not found.");
      });

      it("rejects when ticket already closed", async () => {
        mockGetTicketById.mockReturnValue({
          id: 123,
          status: "closed",
          user_id: "user123",
        });

        const interaction = {
          guildId: "guild123",
          channel: { isThread: () => false },
        };

        const result = await closeModmailThread({
          interaction: interaction as any,
          ticketId: 123,
        });

        expect(result.success).toBe(false);
        expect(result.message).toBe("This ticket is already closed.");
      });
    });

    describe("successful close", () => {
      it("closes an open ticket and reports success", async () => {
        mockGetTicketById.mockReturnValue({
          id: 123,
          status: "open",
          user_id: "user123",
          thread_id: null, // No thread to simplify test
          app_code: "ABC123",
        });
        mockRun.mockReturnValue({ changes: 1 });

        const interaction = {
          guildId: "guild123",
          guild: { name: "Test Guild" },
          user: { id: "mod456" },
          channel: { isThread: () => false },
          client: {
            channels: { fetch: vi.fn().mockResolvedValue(null) },
            users: { fetch: vi.fn().mockRejectedValue(new Error("DM failed")) },
          },
        };

        const result = await closeModmailThread({
          interaction: interaction as any,
          ticketId: 123,
        });

        expect(mockGetTicketById).toHaveBeenCalledWith(123);
        // closeTicket claimed the close (returns 1) and the source ran to completion.
        expect(mockCloseTicket).toHaveBeenCalledWith(123);
        expect(result.success).toBe(true);
        // log channel "log123" + flushTranscript messageId "msg123" => log URL.
        expect(result.logUrl).toBe("https://discord.com/channels/guild123/log123/msg123");
      });

      it("reports a lost race when the close claim returns 0 rows", async () => {
        mockGetTicketById.mockReturnValue({
          id: 123,
          status: "open",
          user_id: "user123",
          thread_id: null,
          app_code: "ABC123",
        });
        // closeTicket reports 0: a concurrent close already won the claim.
        mockCloseTicket.mockReturnValue(0);

        const interaction = {
          guildId: "guild123",
          guild: { name: "Test Guild" },
          user: { id: "mod456" },
          channel: { isThread: () => false },
          client: {
            channels: { fetch: vi.fn().mockResolvedValue(null) },
            users: { fetch: vi.fn().mockResolvedValue({ send: vi.fn() }) },
          },
        };

        const result = await closeModmailThread({
          interaction: interaction as any,
          ticketId: 123,
        });

        expect(result.success).toBe(false);
        expect(result.message).toBe("This ticket is already closed.");
      });
    });
  });

  describe("closeModmailForApplication", () => {
    // Build a client whose users.fetch returns a captured user object so tests
    // can assert on the DM embed the source actually constructs.
    function makeClientWithUserSpy() {
      const userSend = vi.fn().mockResolvedValue(undefined);
      const client = {
        user: { id: "bot999" },
        channels: { fetch: vi.fn().mockResolvedValue(null) },
        users: { fetch: vi.fn().mockResolvedValue({ id: "user123", send: userSend }) },
      } as any;
      return { client, userSend };
    }

    describe("guard checks", () => {
      it("returns early if no open ticket (does not claim close)", async () => {
        mockGetOpenTicketByUser.mockReturnValue(null);

        await closeModmailForApplication("guild123", "user123", "ABC123", {
          reason: "approved",
          client: {} as any,
          guild: { name: "Test" } as any,
        });

        expect(mockGetOpenTicketByUser).toHaveBeenCalledWith("guild123", "user123");
        // Null guard fires before the atomic close, so closeTicket is never called.
        expect(mockCloseTicket).not.toHaveBeenCalled();
      });

      it("bails out when the atomic close loses the race (closeTicket returns 0)", async () => {
        mockGetOpenTicketByUser.mockReturnValue({
          id: 123,
          status: "open",
          user_id: "user123",
          thread_id: null,
          app_code: "ABC123",
        });
        // A concurrent close already won: closeTicket reports 0 rows changed.
        mockCloseTicket.mockReturnValue(0);
        const { client, userSend } = makeClientWithUserSpy();

        await closeModmailForApplication("guild123", "user123", "ABC123", {
          reason: "approved",
          client,
          guild: { name: "Test" } as any,
        });

        expect(mockCloseTicket).toHaveBeenCalledWith(123);
        // Lost the race: no DM is sent, no transcript flush side effects.
        expect(userSend).not.toHaveBeenCalled();
      });
    });

    describe("user-facing DM embed (reason text)", () => {
      async function runAndGetEmbed(
        reason: "approved" | "rejected" | "permanently rejected" | "kicked" | "voted out"
      ) {
        mockGetOpenTicketByUser.mockReturnValue({
          id: 77,
          status: "open",
          user_id: "user123",
          thread_id: null,
          app_code: "ABC123",
        });
        const { client, userSend } = makeClientWithUserSpy();

        await closeModmailForApplication("guildX", "user123", "ABC123", {
          reason,
          client,
          guild: { name: "Cool Guild" } as any,
        });

        expect(userSend).toHaveBeenCalledTimes(1);
        const payload = userSend.mock.calls[0][0];
        // EmbedBuilder -> .data holds the serialized embed fields.
        return payload.embeds[0].data;
      }

      it("approved maps to the approved sentence", async () => {
        const embed = await runAndGetEmbed("approved");
        expect(embed.description).toContain("Your application has been approved.");
      });

      it("rejected maps to the rejected sentence", async () => {
        const embed = await runAndGetEmbed("rejected");
        expect(embed.description).toContain("Your application has been rejected.");
      });

      it("permanently rejected maps to the permanent-rejection sentence", async () => {
        const embed = await runAndGetEmbed("permanently rejected");
        expect(embed.description).toContain(
          "Your application has been permanently rejected and you cannot apply again."
        );
      });

      it("kicked falls through to the removal sentence", async () => {
        const embed = await runAndGetEmbed("kicked");
        expect(embed.description).toContain("You have been removed from the server.");
      });

      it("voted out falls through to the removal sentence (default branch)", async () => {
        const embed = await runAndGetEmbed("voted out");
        expect(embed.description).toContain("You have been removed from the server.");
      });
    });

    describe("close embed structure (produced by source)", () => {
      it("uses the Modmail Closed title, gray color, and includes guild name", async () => {
        mockGetOpenTicketByUser.mockReturnValue({
          id: 5,
          status: "open",
          user_id: "user123",
          thread_id: null,
          app_code: "ABC123",
        });
        const { client, userSend } = makeClientWithUserSpy();

        await closeModmailForApplication("guildX", "user123", "ABC123", {
          reason: "approved",
          client,
          guild: { name: "Cool Guild" } as any,
        });

        const embed = userSend.mock.calls[0][0].embeds[0].data;
        expect(embed.title).toBe("Modmail Closed");
        expect(embed.color).toBe(0x808080);
        expect(embed.description).toContain("Cool Guild");
        expect(embed.description).toContain("**Reason:**");
      });

      it("attaches a transcript file when the buffer has lines", async () => {
        mockGetOpenTicketByUser.mockReturnValue({
          id: 6,
          status: "open",
          user_id: "user123",
          thread_id: null,
          app_code: "ABC123",
        });
        mockGetTranscriptBuffer.mockReturnValue([
          { timestamp: "t", author: "USER", content: "hi" },
        ]);
        const { client, userSend } = makeClientWithUserSpy();

        await closeModmailForApplication("guildX", "user123", "ABC123", {
          reason: "approved",
          client,
          guild: { name: "Cool Guild" } as any,
        });

        const payload = userSend.mock.calls[0][0];
        expect(Array.isArray(payload.files)).toBe(true);
        expect(payload.files).toHaveLength(1);
        expect(payload.files[0].name).toBe("modmail-conversation-ABC123.txt");
      });

      it("omits the transcript file when the buffer is empty", async () => {
        mockGetOpenTicketByUser.mockReturnValue({
          id: 7,
          status: "open",
          user_id: "user123",
          thread_id: null,
          app_code: "ABC123",
        });
        mockGetTranscriptBuffer.mockReturnValue(undefined);
        const { client, userSend } = makeClientWithUserSpy();

        await closeModmailForApplication("guildX", "user123", "ABC123", {
          reason: "approved",
          client,
          guild: { name: "Cool Guild" } as any,
        });

        const payload = userSend.mock.calls[0][0];
        expect(payload.files).toBeUndefined();
      });
    });
  });
});

describe("closeModmailThread log URL", () => {
  beforeEach(() => {
    applyModmailMockDefaults();
  });

  it("builds the Discord message URL from guild, log channel, and message ids", async () => {
    mockGetTicketById.mockReturnValue({
      id: 42,
      status: "open",
      user_id: "user123",
      thread_id: null,
      app_code: "ABC123",
    });
    mockGetConfig.mockReturnValue({ modmail_log_channel_id: "channel456" });

    const interaction = {
      guildId: "guild123",
      guild: { name: "Test Guild" },
      user: { id: "mod456" },
      channel: { isThread: () => false },
      client: {
        channels: { fetch: vi.fn().mockResolvedValue(null) },
        users: { fetch: vi.fn().mockRejectedValue(new Error("DM failed")) },
      },
    } as any;

    const result = await closeModmailThread({ interaction, ticketId: 42 });

    // flushTranscript mock returns messageId "msg123"; source composes the URL.
    expect(result.success).toBe(true);
    expect(result.logUrl).toBe("https://discord.com/channels/guild123/channel456/msg123");
    expect(result.message).toContain(
      "https://discord.com/channels/guild123/channel456/msg123"
    );
  });
});

describe("modmail duplicate close detection (trySendClosingMessage)", () => {
  beforeEach(() => {
    applyModmailMockDefaults();
    // Archive (not delete) so trySendClosingMessage's thread is left intact.
    mockGetConfig.mockReturnValue({
      modmail_log_channel_id: "log123",
      modmail_delete_on_close: false,
    });
  });

  function makeThread(recentMessages: any[]) {
    const send = vi.fn().mockResolvedValue(undefined);
    const thread = {
      id: "thread789",
      isThread: () => true,
      messages: { fetch: vi.fn().mockResolvedValue(recentMessages) },
      send,
      guild: { members: { me: { id: "bot999" } } },
      permissionsFor: vi.fn().mockReturnValue({ has: () => false }),
      edit: vi.fn().mockResolvedValue(undefined),
      members: { remove: vi.fn().mockResolvedValue(undefined) },
    };
    return { thread, send };
  }

  it("skips sending a closing message when one already exists (idempotent)", async () => {
    mockGetOpenTicketByUser.mockReturnValue({
      id: 9,
      status: "open",
      user_id: "user123",
      thread_id: "thread789",
      app_code: "ABC123",
    });

    // recent messages already contain a "Modmail Closed" embed
    const existing = [{ embeds: [{ title: "Modmail Closed" }] }];
    const { thread, send } = makeThread(existing);

    const client = {
      user: { id: "bot999" },
      channels: { fetch: vi.fn().mockResolvedValue(thread) },
      users: { fetch: vi.fn().mockResolvedValue({ id: "user123", send: vi.fn() }) },
    } as any;

    await closeModmailForApplication("guildX", "user123", "ABC123", {
      reason: "approved",
      client,
      guild: { name: "Cool Guild" } as any,
    });

    // Duplicate detected: no new closing embed is sent into the thread.
    expect(send).not.toHaveBeenCalled();
  });

  it("sends a closing message when none exists yet", async () => {
    mockGetOpenTicketByUser.mockReturnValue({
      id: 10,
      status: "open",
      user_id: "user123",
      thread_id: "thread789",
      app_code: "ABC123",
    });

    const noClose = [{ embeds: [{ title: "Modmail Thread" }] }];
    const { thread, send } = makeThread(noClose);

    const client = {
      user: { id: "bot999" },
      channels: { fetch: vi.fn().mockResolvedValue(thread) },
      users: { fetch: vi.fn().mockResolvedValue({ id: "user123", send: vi.fn() }) },
    } as any;

    await closeModmailForApplication("guildX", "user123", "ABC123", {
      reason: "approved",
      client,
      guild: { name: "Cool Guild" } as any,
    });

    // No duplicate present: the source sends a "Modmail Closed" embed.
    expect(send).toHaveBeenCalledTimes(1);
    const embed = send.mock.calls[0][0].embeds[0].data;
    expect(embed.title).toBe("Modmail Closed");
    expect(embed.color).toBe(0x808080);
    expect(embed.description).toContain("Your application has been approved.");
  });
});

describe("modmail archive/delete strategies (archiveOrDeleteThread)", () => {
  beforeEach(() => {
    applyModmailMockDefaults();
  });

  function makeThread() {
    return {
      id: "thread789",
      isThread: () => true,
      messages: { fetch: vi.fn().mockResolvedValue(null) },
      send: vi.fn().mockResolvedValue(undefined),
      // Bot has ManageThreads so delete is attempted when deleteOnClose is true.
      guild: { members: { me: { id: "bot999" } } },
      permissionsFor: vi.fn().mockReturnValue({ has: () => true }),
      delete: vi.fn().mockResolvedValue(undefined),
      edit: vi.fn().mockResolvedValue(undefined),
      members: { remove: vi.fn().mockResolvedValue(undefined) },
    };
  }

  async function runWithConfig(cfg: Record<string, unknown>) {
    mockGetConfig.mockReturnValue(cfg);
    mockGetOpenTicketByUser.mockReturnValue({
      id: 11,
      status: "open",
      user_id: "user123",
      thread_id: "thread789",
      app_code: "ABC123",
    });
    const thread = makeThread();
    const client = {
      user: { id: "bot999" },
      channels: { fetch: vi.fn().mockResolvedValue(thread) },
      users: { fetch: vi.fn().mockResolvedValue({ id: "user123", send: vi.fn() }) },
    } as any;

    await closeModmailForApplication("guildX", "user123", "ABC123", {
      reason: "approved",
      client,
      guild: { name: "Cool Guild" } as any,
    });
    return thread;
  }

  it("deletes the thread when modmail_delete_on_close is undefined (defaults to delete)", async () => {
    const thread = await runWithConfig({ modmail_log_channel_id: "log123" });
    expect(thread.delete).toHaveBeenCalled();
    expect(thread.edit).not.toHaveBeenCalled();
  });

  it("deletes the thread when modmail_delete_on_close is truthy (1)", async () => {
    const thread = await runWithConfig({ modmail_delete_on_close: 1 });
    expect(thread.delete).toHaveBeenCalled();
  });

  it("archives instead of deleting when modmail_delete_on_close is 0", async () => {
    const thread = await runWithConfig({ modmail_delete_on_close: 0 });
    // Coerced to false: the source archives+locks rather than deleting.
    expect(thread.delete).not.toHaveBeenCalled();
    expect(thread.edit).toHaveBeenCalledWith({ archived: true, locked: true });
  });
});
