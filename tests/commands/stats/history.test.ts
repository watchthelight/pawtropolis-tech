/**
 * Pawtropolis Tech — tests/commands/stats/history.test.ts
 * WHAT: Unit tests for /stats history command handler.
 * WHY: Verify moderator history display, CSV export, and leadership permissions.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockInteraction, createMockUser, createMockGuild, createMockMember } from "../../utils/discordMocks.js";
import { createTestCommandContext } from "../../utils/contextFactory.js";

// Hoisted mocks. The db layer is routed by SQL text (see mockPrepare below) so each
// distinct query in the handler resolves to its own row-set. This avoids the prior
// tautology where every .all() returned [] because the bound parameters (not the SQL)
// were inspected. See finding #00216.
const {
  mockPrepare,
  mockGetTotal,
  mockAllCounts,
  mockAllResponse,
  mockAllDaily,
  mockAllExport,
  mockIsOwner,
  mockHasStaffPermissions,
  mockGetConfig,
  mockIsGuildMember,
  mockComputePercentiles,
  mockDetectModeratorAnomalies,
  mockGenerateModHistoryCsv,
  mockLogActionPretty,
  mockWriteFileSync,
  mockMkdirSync,
} = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockGetTotal: vi.fn(),
  mockAllCounts: vi.fn(),
  mockAllResponse: vi.fn(),
  mockAllDaily: vi.fn(),
  mockAllExport: vi.fn(),
  mockIsOwner: vi.fn(),
  mockHasStaffPermissions: vi.fn(),
  mockGetConfig: vi.fn(),
  mockIsGuildMember: vi.fn(),
  mockComputePercentiles: vi.fn(),
  mockDetectModeratorAnomalies: vi.fn(),
  mockGenerateModHistoryCsv: vi.fn(),
  mockLogActionPretty: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
}));

// Mock shared module
vi.mock("../../../src/commands/stats/shared.js", async () => {
  const { EmbedBuilder, MessageFlags, AttachmentBuilder } = await vi.importActual("discord.js");
  return {
    ChatInputCommandInteraction: {},
    EmbedBuilder,
    MessageFlags,
    AttachmentBuilder,
    db: { prepare: mockPrepare },
    isOwner: mockIsOwner,
    hasStaffPermissions: mockHasStaffPermissions,
    getConfig: mockGetConfig,
    isGuildMember: mockIsGuildMember,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    // CommandContext helpers - passthrough implementations
    withStep: async <T>(_ctx: unknown, _phase: string, fn: () => Promise<T> | T) => fn(),
    withSql: <T>(_ctx: unknown, _sql: string, fn: () => T) => fn(),
    ensureDeferred: async (interaction: any) => { await interaction.deferReply({ flags: 64 }); },
    replyOrEdit: async () => {},
  };
});

vi.mock("../../../src/lib/percentiles.js", () => ({
  computePercentiles: mockComputePercentiles,
}));

vi.mock("../../../src/lib/anomaly.js", () => ({
  detectModeratorAnomalies: mockDetectModeratorAnomalies,
}));

vi.mock("../../../src/lib/csv.js", () => ({
  generateModHistoryCsv: mockGenerateModHistoryCsv,
}));

vi.mock("../../../src/logging/pretty.js", () => ({
  logActionPretty: mockLogActionPretty,
}));

vi.mock("node:fs", () => ({
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
}));

vi.mock("node:crypto", () => ({
  randomBytes: vi.fn(() => ({ toString: () => "abcd1234" })),
}));

import { handleHistory } from "../../../src/commands/stats/history.js";

/**
 * Routes a prepared SQL string to the correct row-source mock.
 *
 * The handler calls db.prepare(SQL) with five distinct query strings and then
 * .get()/.all() with bound parameters. The bound parameters are identical across
 * queries (moderator id, guild id, from timestamp), so routing MUST key off the
 * SQL text, not the arguments. This is the core of finding #00216.
 */
function routePrepare(sql: string): { get: typeof mockGetTotal; all: ReturnType<typeof vi.fn> } {
  const normalized = sql.replace(/\s+/g, " ");

  if (normalized.includes("GROUP BY action")) {
    return { get: mockGetTotal, all: mockAllCounts };
  }
  if (normalized.includes("response_ms")) {
    return { get: mockGetTotal, all: mockAllResponse };
  }
  if (normalized.includes("GROUP BY day")) {
    return { get: mockGetTotal, all: mockAllDaily };
  }
  if (normalized.includes("ORDER BY created_at_s DESC")) {
    return { get: mockGetTotal, all: mockAllExport };
  }
  // COUNT(*) total / export-size check resolve via .get().
  return { get: mockGetTotal, all: vi.fn(() => []) };
}

describe("stats/history", () => {
  const mockModeratorUser = createMockUser({ id: "mod-user-123", tag: "TestMod#0001" });

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsOwner.mockReturnValue(false);
    mockHasStaffPermissions.mockReturnValue(true);
    mockGetConfig.mockReturnValue(null);
    mockIsGuildMember.mockReturnValue(true);
    mockPrepare.mockImplementation((sql: string) => routePrepare(sql));
    mockGetTotal.mockReturnValue({ total: 100 });
    // Per-action counts: this is the row-set the embed's Approvals/Rejections/Reject
    // Rate fields are computed from. Routed by the "GROUP BY action" SQL.
    mockAllCounts.mockReturnValue([
      { action: "approve", cnt: 80 },
      { action: "reject", cnt: 15 },
      { action: "kick", cnt: 5 },
    ]);
    mockAllResponse.mockReturnValue([]);
    mockAllDaily.mockReturnValue([]);
    mockAllExport.mockReturnValue([]);
    mockComputePercentiles.mockReturnValue(new Map([[50, 30000], [95, 120000]]));
    mockDetectModeratorAnomalies.mockReturnValue({ isAnomaly: false, score: 0.5, reason: "" });
    mockLogActionPretty.mockResolvedValue(undefined);
  });

  describe("guild validation", () => {
    it("replies with error when used outside a guild", async () => {
      const interaction = createMockInteraction({
        guildId: null,
        options: { getUser: { moderator: mockModeratorUser } },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: "This command can only be used in a server.",
        flags: 64,
      });
    });

    it("does not defer reply when guild is missing", async () => {
      const interaction = createMockInteraction({
        guildId: null,
        options: { getUser: { moderator: mockModeratorUser } },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(interaction.deferReply).not.toHaveBeenCalled();
    });
  });

  describe("leadership permission checks", () => {
    it("allows bot owner", async () => {
      mockIsOwner.mockReturnValue(true);
      mockHasStaffPermissions.mockReturnValue(false);
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(interaction.deferReply).toHaveBeenCalled();
    });

    it("allows guild owner", async () => {
      mockIsOwner.mockReturnValue(false);
      mockHasStaffPermissions.mockReturnValue(false);
      const mockGuild = createMockGuild({ ownerId: "user-123" });
      const interaction = createMockInteraction({
        user: { id: "user-123" },
        guild: mockGuild,
        options: { getUser: { moderator: mockModeratorUser } },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(interaction.deferReply).toHaveBeenCalled();
    });

    it("allows staff permissions", async () => {
      mockHasStaffPermissions.mockReturnValue(true);
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(interaction.deferReply).toHaveBeenCalled();
    });

    it("allows leadership role", async () => {
      mockIsOwner.mockReturnValue(false);
      mockHasStaffPermissions.mockReturnValue(false);
      mockGetConfig.mockReturnValue({ leadership_role_id: "leadership-role" });
      mockIsGuildMember.mockReturnValue(true);

      const member = createMockMember();
      (member.roles.cache as Map<string, any>).set("leadership-role", {});

      const interaction = createMockInteraction({
        member,
        options: { getUser: { moderator: mockModeratorUser } },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(interaction.deferReply).toHaveBeenCalled();
    });

    it("denies without leadership permissions", async () => {
      mockIsOwner.mockReturnValue(false);
      mockHasStaffPermissions.mockReturnValue(false);
      mockGetConfig.mockReturnValue(null);

      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(interaction.reply).toHaveBeenCalledWith({
        content: "This command requires leadership role or admin permissions.",
        flags: 64,
      });
    });

    it("denies when member permissions is a string", async () => {
      mockIsOwner.mockReturnValue(false);
      const interaction = createMockInteraction({
        member: { permissions: "0" },
        options: { getUser: { moderator: mockModeratorUser } },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("leadership") })
      );
    });
  });

  describe("options handling", () => {
    it("uses required moderator option", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(interaction.options.getUser).toHaveBeenCalledWith("moderator", true);
    });

    it("uses default days (30) when not provided", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser }, getInteger: { days: null } },
      });
      const ctx = createTestCommandContext(interaction);

      const before = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
      await handleHistory(ctx);
      const after = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;

      // The total-count query binds (moderatorId, guildId, fromTimestamp). With days
      // defaulting to 30, fromTimestamp must land in the ~30-days-ago window.
      const totalCall = mockGetTotal.mock.calls[0];
      expect(totalCall[0]).toBe("mod-user-123");
      expect(totalCall[2]).toBeGreaterThanOrEqual(before - 1);
      expect(totalCall[2]).toBeLessThanOrEqual(after + 1);
    });

    it("uses provided days value", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser }, getInteger: { days: 60 } },
      });
      const ctx = createTestCommandContext(interaction);

      const expected = Math.floor(Date.now() / 1000) - 60 * 24 * 60 * 60;
      await handleHistory(ctx);

      const totalCall = mockGetTotal.mock.calls[0];
      expect(totalCall[2]).toBeGreaterThanOrEqual(expected - 2);
      expect(totalCall[2]).toBeLessThanOrEqual(expected + 2);
    });

    it("uses default export (false) when not provided", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser }, getBoolean: { export: null } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      // No export means no export-only queries and no file attachment.
      expect(mockGenerateModHistoryCsv).not.toHaveBeenCalled();
      const lastCall = (interaction.editReply as any).mock.calls.at(-1)[0];
      expect(lastCall.files).toBeUndefined();
    });
  });

  describe("successful execution", () => {
    it("defers reply ephemerally", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 64 });
    });

    it("replies with embed containing history", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([expect.any(Object)]),
        })
      );
    });

    it("embed contains moderator tag in title", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.title).toContain("TestMod#0001");
    });

    it("embed total actions field reflects the count query", async () => {
      mockGetTotal.mockReturnValue({ total: 1234 });
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      const totalField = fields.find((f: any) => f.name === "Total Actions");
      expect(totalField).toBeDefined();
      expect(totalField.value).toBe("1,234");
    });

    it("embed approvals and rejections reflect the per-action counts", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      const approvals = fields.find((f: any) => f.name === "Approvals");
      const rejections = fields.find((f: any) => f.name === "Rejections");
      // Default counts: approve=80, reject=15. These are the real numbers the embed
      // must surface (previously asserted only by field name and silently always 0).
      expect(approvals.value).toBe("80");
      expect(rejections.value).toBe("15");
    });

    it("embed reject rate is computed from approve/reject counts", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      const rejectRate = fields.find((f: any) => f.name === "Reject Rate");
      // 15 / (80 + 15) = 15.789... -> toFixed(1) = "15.8".
      expect(rejectRate.value).toBe("15.8%");
    });

    it("reject rate is 0.0 when there are no decisions", async () => {
      mockAllCounts.mockReturnValue([{ action: "kick", cnt: 3 }]);
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      expect(fields.find((f: any) => f.name === "Approvals").value).toBe("0");
      expect(fields.find((f: any) => f.name === "Rejections").value).toBe("0");
      expect(fields.find((f: any) => f.name === "Reject Rate").value).toBe("0.0%");
    });

    it("embed contains response time percentiles", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      expect(fields).toContainEqual(expect.objectContaining({ name: "Response Time (p50)" }));
      expect(fields).toContainEqual(expect.objectContaining({ name: "Response Time (p95)" }));
    });

    it("logs action to pretty logger", async () => {
      const mockGuild = createMockGuild();
      const interaction = createMockInteraction({
        guild: mockGuild,
        user: { id: "leader-123" },
        options: { getUser: { moderator: mockModeratorUser } },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(mockLogActionPretty).toHaveBeenCalledWith(
        mockGuild,
        expect.objectContaining({
          action: "stats_history_view",
          actorId: "leader-123",
        })
      );
    });
  });

  describe("anomaly detection", () => {
    it("calls detectModeratorAnomalies with the daily counts row-set", async () => {
      mockAllDaily.mockReturnValue([
        { day: "2024-01-01", cnt: 10 },
        { day: "2024-01-02", cnt: 15 },
        { day: "2024-01-03", cnt: 12 },
      ]);
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      // The handler maps daily rows to their cnt values before calling anomaly detection.
      expect(mockDetectModeratorAnomalies).toHaveBeenCalledWith([10, 15, 12]);
    });

    it("shows anomaly warning when detected", async () => {
      mockDetectModeratorAnomalies.mockReturnValue({
        isAnomaly: true,
        score: 3.5,
        reason: "Unusually high activity",
      });
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const fields = call.embeds[0].data.fields;
      expect(fields).toContainEqual(
        expect.objectContaining({
          name: "Anomaly Detected",
          value: expect.stringContaining("3.50"),
        })
      );
    });

    it("uses warning color when anomaly detected", async () => {
      mockDetectModeratorAnomalies.mockReturnValue({
        isAnomaly: true,
        score: 2.8,
        reason: "Suspicious pattern",
      });
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.color).toBe(0xfaa61a);
    });

    it("uses normal color when no anomaly", async () => {
      mockDetectModeratorAnomalies.mockReturnValue({
        isAnomaly: false,
        score: 0.5,
        reason: "",
      });
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.color).toBe(0x5865f2);
    });
  });

  describe("CSV export", () => {
    beforeEach(() => {
      mockAllExport.mockReturnValue([
        { id: 1, action: "approve", actor_id: "mod-123", created_at_s: 1700000000 },
        { id: 2, action: "reject", actor_id: "mod-123", created_at_s: 1700000100 },
      ]);
      mockGenerateModHistoryCsv.mockReturnValue("id,action,actor_id\n1,approve,mod-123\n2,reject,mod-123");
    });

    it("does not write the CSV to disk (#00106/#00107)", async () => {
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser }, getBoolean: { export: true } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      // CSV is now attached to the reply, never persisted to data/exports.
      expect(mockMkdirSync).not.toHaveBeenCalled();
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it("generates the CSV from the exported rows", async () => {
      const interaction = createMockInteraction({
        guild: createMockGuild(),
        options: { getUser: { moderator: mockModeratorUser }, getBoolean: { export: true } },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(mockGenerateModHistoryCsv).toHaveBeenCalledWith([
        { id: 1, action: "approve", actor_id: "mod-123", created_at_s: 1700000000 },
        { id: 2, action: "reject", actor_id: "mod-123", created_at_s: 1700000100 },
      ]);
    });

    it("attaches the CSV as a file on the reply", async () => {
      const interaction = createMockInteraction({
        guild: createMockGuild(),
        options: { getUser: { moderator: mockModeratorUser }, getBoolean: { export: true } },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const calls = (interaction.editReply as any).mock.calls.map((c: any[]) => c[0]);
      const withFiles = calls.find((c: any) => Array.isArray(c?.files) && c.files.length > 0);
      expect(withFiles).toBeTruthy();
    });

    it("notes the attachment in the embed (no dead download link)", async () => {
      const interaction = createMockInteraction({
        guild: createMockGuild(),
        options: { getUser: { moderator: mockModeratorUser }, getBoolean: { export: true } },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const calls = (interaction.editReply as any).mock.calls.map((c: any[]) => c[0]);
      const exportCall = calls.find((c: any) => Array.isArray(c?.files) && c.files.length > 0) ?? calls[calls.length - 1];
      const fields = exportCall.embeds[0].data.fields;
      expect(fields).toContainEqual(
        expect.objectContaining({
          name: "CSV Export",
          value: expect.stringContaining("Attached below"),
        })
      );
    });

    it("logs export action", async () => {
      const mockGuild = createMockGuild();
      const interaction = createMockInteraction({
        guild: mockGuild,
        user: { id: "leader-456" },
        options: { getUser: { moderator: mockModeratorUser }, getBoolean: { export: true } },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(mockLogActionPretty).toHaveBeenCalledWith(
        mockGuild,
        expect.objectContaining({
          action: "stats_history_export",
        })
      );
    });

    it("enforces export row limit", async () => {
      mockGetTotal.mockReturnValue({ total: 60000 }); // Over 50000 limit
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser }, getBoolean: { export: true } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining("exceeds limit"),
      });
    });
  });

  describe("high volume warning", () => {
    it("shows sampling note for high volume moderators", async () => {
      mockGetTotal.mockReturnValue({ total: 15000 });
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      expect(call.embeds[0].data.description).toContain("sampled");
    });
  });

  describe("error handling", () => {
    it("logs error when query fails", async () => {
      mockPrepare.mockImplementation(() => {
        throw new Error("Database error");
      });
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const { logger } = await import("../../../src/commands/stats/shared.js");
      expect(logger.error).toHaveBeenCalled();
    });

    it("sends user-friendly error message", async () => {
      mockPrepare.mockImplementation(() => {
        throw new Error("Query failed");
      });
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: "Failed to fetch moderator history. Please try again later.",
      });
    });
  });

  describe("response time formatting", () => {
    it("shows N/A when no p50 data", async () => {
      mockComputePercentiles.mockReturnValue(new Map());
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const p50Field = call.embeds[0].data.fields.find((f: any) => f.name === "Response Time (p50)");
      expect(p50Field.value).toBe("N/A");
    });

    it("converts ms to seconds for display", async () => {
      mockComputePercentiles.mockReturnValue(new Map([[50, 60000], [95, 180000]]));
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const call = (interaction.editReply as any).mock.calls[0][0];
      const p50Field = call.embeds[0].data.fields.find((f: any) => f.name === "Response Time (p50)");
      expect(p50Field.value).toBe("60s");
    });

    it("feeds positive response_ms rows to computePercentiles", async () => {
      mockAllResponse.mockReturnValue([{ ms: 1000 }, { ms: 0 }, { ms: 5000 }, { ms: -3 }]);
      const interaction = createMockInteraction({
        options: { getUser: { moderator: mockModeratorUser } },
      });
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      // Handler filters to ms > 0 before computing percentiles.
      expect(mockComputePercentiles).toHaveBeenCalledWith([1000, 5000], [50, 95]);
    });
  });

  describe("logging", () => {
    it("logs command execution", async () => {
      const interaction = createMockInteraction({
        user: { id: "leader-789" },
        guildId: "guild-456",
        options: { getUser: { moderator: mockModeratorUser }, getInteger: { days: 14 }, getBoolean: { export: false } },
      } as any);
      const ctx = createTestCommandContext(interaction);

      await handleHistory(ctx);

      const { logger } = await import("../../../src/commands/stats/shared.js");
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          moderatorId: "mod-user-123",
          guildId: "guild-456",
          days: 14,
          exportCsv: false,
        }),
        "[stats:history] command executed"
      );
    });
  });
});
