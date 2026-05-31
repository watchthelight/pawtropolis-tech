/**
 * Pawtropolis Tech — tests/features/modmail/threadOpen.test.ts
 * WHAT: Unit tests for modmail thread opening module.
 * WHY: Verify thread creation, permission checks, and race condition handling.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChannelType } from "discord.js";

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
  newTraceId: vi.fn(() => "trace-test"),
  ctx: vi.fn(() => ({ traceId: "trace-test" })),
}));

vi.mock("../../../src/lib/ids.js", () => ({
  shortCode: vi.fn((id: string) => id.slice(0, 8)),
}));

vi.mock("../../../src/lib/config.js", () => ({
  hasManageGuild: vi.fn(() => true),
  isReviewer: vi.fn(() => true),
  canRunAllCommands: vi.fn(() => true),
}));

vi.mock("../../../src/logging/pretty.js", () => ({
  logActionPretty: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/lib/constants.js", () => ({
  SAFE_ALLOWED_MENTIONS: { parse: [] },
}));

vi.mock("../../../src/features/modmail/tickets.js", () => ({
  createTicket: vi.fn(() => 123),
}));

vi.mock("../../../src/features/modmail/threadState.js", () => ({
  addOpenThread: vi.fn(),
}));

vi.mock("../../../src/features/modmail/threadPerms.js", () => ({
  missingPermsForStartThread: vi.fn(() => []),
  ensureModsCanSpeakInThread: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/web/notifyDashboard.js", () => ({
  notifyDashboard: vi.fn(),
}));

import { openPublicModmailThreadFor } from "../../../src/features/modmail/threadOpen.js";
import { hasManageGuild, isReviewer, canRunAllCommands } from "../../../src/lib/config.js";
import { missingPermsForStartThread } from "../../../src/features/modmail/threadPerms.js";

const mockHasManageGuild = hasManageGuild as ReturnType<typeof vi.fn>;
const mockIsReviewer = isReviewer as ReturnType<typeof vi.fn>;
const mockCanRunAllCommands = canRunAllCommands as ReturnType<typeof vi.fn>;
const mockMissingPermsForStartThread = missingPermsForStartThread as ReturnType<typeof vi.fn>;

describe("features/modmail/threadOpen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({
      get: mockGet,
      run: mockRun,
    });
    mockHasManageGuild.mockReturnValue(true);
    mockIsReviewer.mockReturnValue(true);
    mockCanRunAllCommands.mockReturnValue(true);
    mockMissingPermsForStartThread.mockReturnValue([]);
  });

  describe("openPublicModmailThreadFor", () => {
    describe("guild validation", () => {
      it("rejects non-guild interactions", async () => {
        const interaction = {
          guildId: null,
          guild: null,
        };

        const result = await openPublicModmailThreadFor({
          interaction: interaction as any,
          userId: "user123",
        });

        expect(result.success).toBe(false);
        expect(result.message).toBe("Guild only.");
      });
    });

    describe("permission checks", () => {
      it("rejects when user lacks all permissions", async () => {
        mockCanRunAllCommands.mockReturnValue(false);
        mockHasManageGuild.mockReturnValue(false);
        mockIsReviewer.mockReturnValue(false);

        const interaction = {
          guildId: "guild123",
          guild: { id: "guild123" },
          member: { id: "user456" },
        };

        const result = await openPublicModmailThreadFor({
          interaction: interaction as any,
          userId: "user123",
        });

        expect(result.success).toBe(false);
        expect(result.message).toBe("You do not have permission for this.");
      });

      it("allows users with canRunAllCommands", async () => {
        mockCanRunAllCommands.mockReturnValue(true);
        mockHasManageGuild.mockReturnValue(false);
        mockIsReviewer.mockReturnValue(false);
        mockGet.mockReturnValue({ thread_id: "existing123" });

        const interaction = {
          guildId: "guild123",
          guild: { id: "guild123" },
          member: { id: "user456" },
        };

        const result = await openPublicModmailThreadFor({
          interaction: interaction as any,
          userId: "user123",
        });

        // Should pass permission check (fails at existing thread check)
        expect(result.message).toContain("already exists");
      });

      it("allows users with hasManageGuild", async () => {
        mockCanRunAllCommands.mockReturnValue(false);
        mockHasManageGuild.mockReturnValue(true);
        mockIsReviewer.mockReturnValue(false);
        mockGet.mockReturnValue({ thread_id: "existing123" });

        const interaction = {
          guildId: "guild123",
          guild: { id: "guild123" },
          member: { id: "user456" },
        };

        const result = await openPublicModmailThreadFor({
          interaction: interaction as any,
          userId: "user123",
        });

        // Should pass permission check
        expect(result.message).toContain("already exists");
      });

      it("allows users with isReviewer", async () => {
        mockCanRunAllCommands.mockReturnValue(false);
        mockHasManageGuild.mockReturnValue(false);
        mockIsReviewer.mockReturnValue(true);
        mockGet.mockReturnValue({ thread_id: "existing123" });

        const interaction = {
          guildId: "guild123",
          guild: { id: "guild123" },
          member: { id: "user456" },
        };

        const result = await openPublicModmailThreadFor({
          interaction: interaction as any,
          userId: "user123",
        });

        // Should pass permission check
        expect(result.message).toContain("already exists");
      });
    });

    describe("existing thread detection", () => {
      it("returns existing thread link when found", async () => {
        mockGet.mockReturnValue({ thread_id: "thread123" });

        const interaction = {
          guildId: "guild123",
          guild: { id: "guild123" },
          member: { id: "user456" },
        };

        const result = await openPublicModmailThreadFor({
          interaction: interaction as any,
          userId: "user123",
        });

        expect(result.success).toBe(false);
        expect(result.message).toBe("Modmail thread already exists: <#thread123>");
      });

      it("returns pending message when thread is being created", async () => {
        mockGet.mockReturnValue({ thread_id: "pending" });

        const interaction = {
          guildId: "guild123",
          guild: { id: "guild123" },
          member: { id: "user456" },
        };

        const result = await openPublicModmailThreadFor({
          interaction: interaction as any,
          userId: "user123",
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain("being created by another moderator");
      });
    });

    describe("channel validation", () => {
      it("rejects DM channels", async () => {
        mockGet.mockReturnValue(undefined);

        const interaction = {
          guildId: "guild123",
          guild: { id: "guild123", members: { me: { id: "bot123" } } },
          member: { id: "user456" },
          channel: { type: ChannelType.DM },
          client: {
            users: { fetch: vi.fn().mockResolvedValue({ id: "user123", username: "test" }) },
          },
        };

        const result = await openPublicModmailThreadFor({
          interaction: interaction as any,
          userId: "user123",
        });

        expect(result.success).toBe(false);
        expect(result.message).toBe("Cannot create thread in this channel.");
      });

      it("rejects non-text/news/forum channels", async () => {
        mockGet.mockReturnValue(undefined);

        const interaction = {
          guildId: "guild123",
          guild: { id: "guild123", members: { me: { id: "bot123" } } },
          member: { id: "user456" },
          channel: {
            type: ChannelType.GuildVoice,
            permissionsFor: vi.fn(),
          },
          client: {
            users: { fetch: vi.fn().mockResolvedValue({ id: "user123", username: "test" }) },
          },
        };

        const result = await openPublicModmailThreadFor({
          interaction: interaction as any,
          userId: "user123",
        });

        expect(result.success).toBe(false);
        expect(result.message).toBe("Modmail is only supported in text/news/forum channels.");
      });
    });

    describe("bot permission checks", () => {
      it("reports missing permissions", async () => {
        mockGet.mockReturnValue(undefined);
        mockMissingPermsForStartThread.mockReturnValue(["CreatePublicThreads", "SendMessages"]);

        const interaction = {
          guildId: "guild123",
          guild: { id: "guild123", members: { me: { id: "bot123" } } },
          member: { id: "user456" },
          channel: {
            id: "channel123",
            type: ChannelType.GuildText,
            permissionsFor: vi.fn(),
          },
          client: {
            users: { fetch: vi.fn().mockResolvedValue({ id: "user123", username: "test" }) },
          },
        };

        const result = await openPublicModmailThreadFor({
          interaction: interaction as any,
          userId: "user123",
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain("Missing: CreatePublicThreads, SendMessages");
      });

      it("returns error when bot member not found", async () => {
        mockGet.mockReturnValue(undefined);

        const interaction = {
          guildId: "guild123",
          guild: {
            id: "guild123",
            members: { me: null, fetchMe: vi.fn().mockResolvedValue(null) },
          },
          member: { id: "user456" },
          channel: {
            type: ChannelType.GuildText,
            permissionsFor: vi.fn(),
          },
          client: {
            users: { fetch: vi.fn().mockResolvedValue({ id: "user123", username: "test" }) },
          },
        };

        const result = await openPublicModmailThreadFor({
          interaction: interaction as any,
          userId: "user123",
        });

        expect(result.success).toBe(false);
        expect(result.message).toBe("Bot member not found in guild.");
      });
    });
  });
});

// Helper: build a fake User the way discord.js would hand one back.
function makeUser(): any {
  return {
    id: "user123",
    username: "applicant",
    tag: "applicant#0001",
    createdTimestamp: 1_600_000_000_000,
    displayAvatarURL: vi.fn(() => "https://cdn.discordapp.com/avatars/user123/abc.png"),
    send: vi.fn().mockResolvedValue(undefined),
  };
}

// Helper: build an interaction that drives openPublicModmailThreadFor all the
// way through Discord thread creation, capturing what gets sent to the thread.
function makeSuccessInteraction(opts: { sentComponents: any[] }) {
  const user = makeUser();
  const thread = {
    id: "thread999",
    type: ChannelType.PublicThread,
    parentId: "channel123",
    guildId: "guild123",
    autoArchiveDuration: 4320,
    send: vi.fn((payload: any) => {
      if (payload?.components) opts.sentComponents.push(...payload.components);
      return Promise.resolve(undefined);
    }),
  };
  const channel = {
    id: "channel123",
    type: ChannelType.GuildText,
    permissionsFor: vi.fn(),
    threads: { create: vi.fn().mockResolvedValue(thread) },
  };
  const interaction = {
    guildId: "guild123",
    guild: {
      id: "guild123",
      name: "Test Guild",
      members: { me: { id: "bot123" } },
    },
    member: { id: "user456" },
    user: { id: "user456" },
    channel,
    client: {
      users: { fetch: vi.fn().mockResolvedValue(user) },
    },
  };
  return { interaction, thread, channel, user };
}

describe("modmail thread customId format", () => {
  // Exercises the real customId construction at threadOpen.ts:384 by driving the
  // full success path and inspecting the button actually emitted to the thread.
  it("emits a close button whose customId encodes the real ticket id", async () => {
    mockGet.mockReturnValue(undefined); // no existing thread

    const sentComponents: any[] = [];
    const { interaction } = makeSuccessInteraction({ sentComponents });

    const result = await openPublicModmailThreadFor({
      interaction: interaction as any,
      userId: "user123",
    });

    expect(result.success).toBe(true);
    expect(result.message).toBe("Modmail thread created: <#thread999>");

    // createTicket is mocked to return 123, so the real code must build
    // "v1:modmail:close:123" at threadOpen.ts:384.
    const customIds = sentComponents
      .flatMap((row: any) => row.components ?? [])
      .map((btn: any) => btn.data?.custom_id)
      .filter(Boolean);

    expect(customIds).toContain("v1:modmail:close:123");

    // And the emitted id is parseable back to the ticket id.
    const closeId = customIds.find((id: string) => id.startsWith("v1:modmail:close:"));
    const match = closeId?.match(/^v1:modmail:close:(\d+)$/);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe("123");
  });
});

describe("modmail race condition handling", () => {
  // Exercises the real race-detection branch in the catch block
  // (threadOpen.ts:444-473) by making thread creation throw a constraint error.
  describe("pending state", () => {
    it("returns the 'being created' message when the race winner is still pending", async () => {
      // No existing row on the fast path or in-transaction check, so the code
      // proceeds to create the Discord thread.
      mockGet
        .mockReturnValueOnce(undefined) // fast-path SELECT
        .mockReturnValueOnce(undefined) // in-transaction guard SELECT
        .mockReturnValueOnce({ thread_id: "pending" }); // post-error lookup

      const sentComponents: any[] = [];
      const { interaction, channel } = makeSuccessInteraction({ sentComponents });
      const raceErr: any = new Error("UNIQUE constraint failed: open_modmail.guild_id");
      channel.threads.create.mockRejectedValue(raceErr);

      const result = await openPublicModmailThreadFor({
        interaction: interaction as any,
        userId: "user123",
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("being created by another moderator");
    });

    it("links to the winner's thread when a non-pending thread already exists", async () => {
      mockGet
        .mockReturnValueOnce(undefined) // fast-path SELECT
        .mockReturnValueOnce(undefined) // in-transaction guard SELECT
        .mockReturnValueOnce({ thread_id: "winner777" }); // post-error lookup

      const sentComponents: any[] = [];
      const { interaction, channel } = makeSuccessInteraction({ sentComponents });
      const raceErr: any = new Error("PRIMARY KEY constraint failed");
      channel.threads.create.mockRejectedValue(raceErr);

      const result = await openPublicModmailThreadFor({
        interaction: interaction as any,
        userId: "user123",
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe("Modmail thread already exists: <#winner777>");
    });
  });

  describe("primary key constraint detection", () => {
    // Each case proves the real isRaceCondition logic at threadOpen.ts:444-448
    // routes the error to the race branch (linking to the winner's thread)
    // rather than the generic failure message.
    it("treats a UNIQUE constraint error as a race", async () => {
      mockGet
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce({ thread_id: "winnerUNIQUE" });

      const sentComponents: any[] = [];
      const { interaction, channel } = makeSuccessInteraction({ sentComponents });
      channel.threads.create.mockRejectedValue(new Error("UNIQUE constraint failed"));

      const result = await openPublicModmailThreadFor({
        interaction: interaction as any,
        userId: "user123",
      });

      expect(result.message).toBe("Modmail thread already exists: <#winnerUNIQUE>");
    });

    it("treats a PRIMARY KEY constraint error as a race", async () => {
      mockGet
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce({ thread_id: "winnerPK" });

      const sentComponents: any[] = [];
      const { interaction, channel } = makeSuccessInteraction({ sentComponents });
      channel.threads.create.mockRejectedValue(new Error("PRIMARY KEY constraint failed"));

      const result = await openPublicModmailThreadFor({
        interaction: interaction as any,
        userId: "user123",
      });

      expect(result.message).toBe("Modmail thread already exists: <#winnerPK>");
    });

    it("treats a SQLITE_CONSTRAINT code as a race", async () => {
      mockGet
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce({ thread_id: "winnerCODE" });

      const sentComponents: any[] = [];
      const { interaction, channel } = makeSuccessInteraction({ sentComponents });
      const codeErr: any = new Error("constraint");
      codeErr.code = "SQLITE_CONSTRAINT";
      channel.threads.create.mockRejectedValue(codeErr);

      const result = await openPublicModmailThreadFor({
        interaction: interaction as any,
        userId: "user123",
      });

      expect(result.message).toBe("Modmail thread already exists: <#winnerCODE>");
    });

    it("falls back to the generic failure message for a non-race error", async () => {
      mockGet.mockReturnValue(undefined);

      const sentComponents: any[] = [];
      const { interaction, channel } = makeSuccessInteraction({ sentComponents });
      channel.threads.create.mockRejectedValue(new Error("network exploded"));

      const result = await openPublicModmailThreadFor({
        interaction: interaction as any,
        userId: "user123",
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("Failed to create modmail thread");
    });
  });
});
