/**
 * Pawtropolis Tech — tests/features/review/handlers/buttons.test.ts
 * WHAT: Unit tests for review button handlers.
 * WHY: Verify button routing, staff gating, rate limiting, and mention hardening
 *      by invoking the REAL exported handlers with mocked ButtonInteraction objects.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGet, mockAll, mockRun, mockPrepare } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockAll: vi.fn(),
  mockRun: vi.fn(),
  mockPrepare: vi.fn(),
}));

mockPrepare.mockReturnValue({
  get: mockGet,
  all: mockAll,
  run: mockRun,
});

vi.mock("../../../../src/db/db.js", () => ({
  db: {
    prepare: mockPrepare,
  },
}));

vi.mock("../../../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../../src/lib/sentry.js", () => ({
  captureException: vi.fn(),
}));

// Control the staff gate precisely. The real isStaff()/requireInteractionStaff()
// helpers run; they delegate to these two predicates.
const { mockShouldBypass, mockHasRole } = vi.hoisted(() => ({
  mockShouldBypass: vi.fn(() => false),
  mockHasRole: vi.fn(() => false),
}));

vi.mock("../../../../src/lib/config.js", () => ({
  shouldBypass: mockShouldBypass,
  hasRole: mockHasRole,
  getConfig: vi.fn(),
  ROLE_IDS: {
    GATEKEEPER: "gatekeeper-role-id",
  },
}));

vi.mock("../../../../src/lib/cmdWrap.js", () => ({
  replyOrEdit: vi.fn().mockResolvedValue(undefined),
  ensureDeferred: vi.fn().mockResolvedValue(undefined),
  ephemeralFollowUp: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/lib/ids.js", () => ({
  shortCode: vi.fn((id: string) => id.slice(-6).toUpperCase()),
}));

vi.mock("../../../../src/lib/time.js", () => ({
  nowUtc: vi.fn(() => 1700000000),
}));

vi.mock("../../../../src/lib/autoDelete.js", () => ({
  autoDelete: vi.fn(),
}));

vi.mock("../../../../src/features/appLookup.js", () => ({
  findAppByShortCode: vi.fn(),
}));

// Claim/queries are the DB-backed boundaries the real helpers call.
vi.mock("../../../../src/features/review/claims.js", () => ({
  getClaim: vi.fn(() => null),
  claimGuard: vi.fn(() => null),
}));

vi.mock("../../../../src/features/review/queries.js", () => ({
  loadApplication: vi.fn(),
  getVoteOutVoters: vi.fn(() => []),
}));

// Heavy action runners and claim handlers are external to the routing logic
// under test; stub them so routing can be asserted without their full chains.
vi.mock("../../../../src/features/review/handlers/actionRunners.js", () => ({
  runRejectAction: vi.fn().mockResolvedValue(undefined),
  runVoteOutRetractAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/features/review/handlers/claimHandlers.js", () => ({
  handleClaimToggle: vi.fn().mockResolvedValue(undefined),
}));

import {
  handleReviewButton,
  handleModmailButton,
  handlePermRejectButton,
  handleCopyUidButton,
  handlePingInUnverified,
  handleDeletePing,
} from "../../../../src/features/review/handlers/buttons.js";

import { handleClaimToggle } from "../../../../src/features/review/handlers/claimHandlers.js";

import {
  BTN_DECIDE_RE,
  BTN_MODMAIL_RE,
  BTN_PERM_REJECT_RE,
  BTN_COPY_UID_RE,
} from "../../../../src/lib/modalPatterns.js";

import { findAppByShortCode } from "../../../../src/features/appLookup.js";
import { loadApplication } from "../../../../src/features/review/queries.js";
import { getConfig } from "../../../../src/lib/config.js";
import { replyOrEdit } from "../../../../src/lib/cmdWrap.js";
import { _resetCooldownsForTest } from "../../../../src/features/review/handlers/buttonCooldown.js";

const STAFF_USER = "111111111111111111";

/**
 * Build a mock ButtonInteraction. Real helpers call inGuild(), member access,
 * showModal(), reply(), deferUpdate(), etc. We expose vi.fn() spies for each so
 * the handler's actual control flow can be asserted.
 */
function makeButtonInteraction(
  customId: string,
  opts: {
    guildId?: string | null;
    userId?: string;
    member?: unknown;
    guild?: unknown;
    channel?: unknown;
  } = {}
) {
  const guildId = opts.guildId === undefined ? "guild-1" : opts.guildId;
  const member = "member" in opts ? opts.member : { roles: { cache: new Map() } };
  const interaction = {
    customId,
    id: "9999999990ABCDEF",
    createdTimestamp: Date.now(),
    guildId,
    user: { id: opts.userId ?? STAFF_USER, username: "mod" },
    member,
    guild: opts.guild,
    channel: opts.channel,
    deferred: false,
    replied: false,
    inGuild: vi.fn(() => guildId !== null),
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
    message: { delete: vi.fn().mockResolvedValue(undefined) },
  };
  return interaction;
}

/** Flip the gate so the real isStaff() returns true. */
function asStaff() {
  mockHasRole.mockReturnValue(true);
}

describe("features/review/handlers/buttons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({
      get: mockGet,
      all: mockAll,
      run: mockRun,
    });
    mockShouldBypass.mockReturnValue(false);
    mockHasRole.mockReturnValue(false);
    vi.mocked(findAppByShortCode).mockReturnValue(null);
    vi.mocked(loadApplication).mockReturnValue(undefined);
    _resetCooldownsForTest();
  });

  describe("handleReviewButton", () => {
    it("ignores non-matching customIds (no reply, no gate)", async () => {
      const interaction = makeButtonInteraction("some-other-button");
      await handleReviewButton(interaction as never);
      expect(interaction.reply).not.toHaveBeenCalled();
      expect(interaction.deferUpdate).not.toHaveBeenCalled();
      expect(interaction.showModal).not.toHaveBeenCalled();
    });

    it("real BTN_DECIDE_RE matches the v1 decide pattern", () => {
      // The handler routes off this exact regex; assert against the real one.
      const m = BTN_DECIDE_RE.exec("v1:decide:approve:codeABCDEF");
      expect(m).not.toBeNull();
      expect(m?.[1]).toBe("approve");
      expect(m?.[2]).toBe("ABCDEF");
    });

    it("rejects non-staff with the Gatekeeper-required reply", async () => {
      const interaction = makeButtonInteraction("v1:decide:reject:codeABCDEF");
      // not staff (default), but matches the pattern
      await handleReviewButton(interaction as never);
      expect(interaction.reply).toHaveBeenCalledTimes(1);
      const arg = interaction.reply.mock.calls[0]![0] as { content: string };
      expect(arg.content).toContain("Gatekeeper role required");
      // gate fails => no modal opened, no claim handler
      expect(interaction.showModal).not.toHaveBeenCalled();
    });

    it("routes reject (staff) to the modal opener without deferring", async () => {
      asStaff();
      vi.mocked(findAppByShortCode).mockReturnValue({ id: "app-ABCDEF" } as never);
      vi.mocked(loadApplication).mockReturnValue({
        id: "app-ABCDEF",
        guild_id: "guild-1",
        user_id: "222",
        status: "submitted",
      } as never);

      const interaction = makeButtonInteraction("v1:decide:reject:codeABCDEF");
      await handleReviewButton(interaction as never);

      expect(interaction.showModal).toHaveBeenCalledTimes(1);
      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });

    it("routes claim (staff) through deferUpdate to handleClaimToggle", async () => {
      asStaff();
      const app = {
        id: "app-ABCDEF",
        guild_id: "guild-1",
        user_id: "222",
        status: "submitted",
      };
      vi.mocked(findAppByShortCode).mockReturnValue({ id: "app-ABCDEF" } as never);
      vi.mocked(loadApplication).mockReturnValue(app as never);

      const interaction = makeButtonInteraction("v1:decide:claim:codeABCDEF");
      await handleReviewButton(interaction as never);

      expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
      expect(handleClaimToggle).toHaveBeenCalledTimes(1);
      expect(interaction.showModal).not.toHaveBeenCalled();
    });

    it("silently acks a rate-limited repeat click via deferUpdate", async () => {
      asStaff();
      vi.mocked(findAppByShortCode).mockReturnValue({ id: "app-ABCDEF" } as never);
      vi.mocked(loadApplication).mockReturnValue({
        id: "app-ABCDEF",
        guild_id: "guild-1",
        user_id: "222",
        status: "submitted",
      } as never);

      // First claim click records the cooldown and dispatches.
      const first = makeButtonInteraction("v1:decide:claim:codeABCDEF");
      await handleReviewButton(first as never);
      expect(handleClaimToggle).toHaveBeenCalledTimes(1);

      // Immediate second click on the same user/code/action is rate-limited:
      // it deferUpdate()s to dismiss the spinner and does NOT dispatch again.
      const second = makeButtonInteraction("v1:decide:claim:codeABCDEF");
      await handleReviewButton(second as never);
      expect(second.deferUpdate).toHaveBeenCalledTimes(1);
      expect(handleClaimToggle).toHaveBeenCalledTimes(1);
    });
  });

  describe("handleModmailButton", () => {
    it("real BTN_MODMAIL_RE matches the modmail pattern", () => {
      const m = BTN_MODMAIL_RE.exec("review:modmail:codeABCDEF");
      expect(m).not.toBeNull();
      expect(m?.[1]).toBe("ABCDEF");
    });

    it("returns silently on a non-matching customId", async () => {
      const interaction = makeButtonInteraction("v1:decide:approve:codeABCDEF");
      await handleModmailButton(interaction as never);
      expect(interaction.deferUpdate).not.toHaveBeenCalled();
      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it("rejects non-staff with the Gatekeeper-required reply", async () => {
      const interaction = makeButtonInteraction("review:modmail:codeABCDEF");
      await handleModmailButton(interaction as never);
      expect(interaction.reply).toHaveBeenCalledTimes(1);
      const arg = interaction.reply.mock.calls[0]![0] as { content: string };
      expect(arg.content).toContain("Gatekeeper role required");
      // gate fails before any deferUpdate
      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });
  });

  describe("handlePermRejectButton", () => {
    it("real BTN_PERM_REJECT_RE matches both perm_reject spellings", () => {
      expect(BTN_PERM_REJECT_RE.exec("review:perm_reject:codeABCDEF")?.[2]).toBe("ABCDEF");
      expect(BTN_PERM_REJECT_RE.exec("review:permreject:code123456")?.[2]).toBe("123456");
    });

    it("rejects non-staff with the Gatekeeper-required reply", async () => {
      const interaction = makeButtonInteraction("review:perm_reject:codeABCDEF");
      await handlePermRejectButton(interaction as never);
      expect(interaction.reply).toHaveBeenCalledTimes(1);
      const arg = interaction.reply.mock.calls[0]![0] as { content: string };
      expect(arg.content).toContain("Gatekeeper role required");
    });

    it("opens the permanent-reject modal for staff with a valid app", async () => {
      asStaff();
      vi.mocked(findAppByShortCode).mockReturnValue({ id: "app-ABCDEF" } as never);
      vi.mocked(loadApplication).mockReturnValue({
        id: "app-ABCDEF",
        guild_id: "guild-1",
        user_id: "222",
        status: "submitted",
      } as never);

      const interaction = makeButtonInteraction("review:perm_reject:codeABCDEF");
      await handlePermRejectButton(interaction as never);

      expect(interaction.showModal).toHaveBeenCalledTimes(1);
    });
  });

  describe("handleCopyUidButton", () => {
    it("real BTN_COPY_UID_RE captures code and user", () => {
      const m = BTN_COPY_UID_RE.exec("review:copy_uid:codeABCDEF:user123456789");
      expect(m).not.toBeNull();
      expect(m?.[1]).toBe("ABCDEF");
      expect(m?.[2]).toBe("123456789");
    });

    it("rejects non-staff with the Gatekeeper-required reply", async () => {
      const interaction = makeButtonInteraction("review:copy_uid:codeABCDEF:user123456789");
      await handleCopyUidButton(interaction as never);
      expect(interaction.reply).toHaveBeenCalledTimes(1);
      const arg = interaction.reply.mock.calls[0]![0] as { content: string };
      expect(arg.content).toContain("Gatekeeper role required");
    });

    it("refuses to leak a UID when no application exists for the code (security check)", async () => {
      asStaff();
      vi.mocked(findAppByShortCode).mockReturnValue(null);

      const interaction = makeButtonInteraction("review:copy_uid:codeABCDEF:user123456789");
      await handleCopyUidButton(interaction as never);

      expect(interaction.reply).toHaveBeenCalledTimes(1);
      const arg = interaction.reply.mock.calls[0]![0] as { content: string };
      expect(arg.content).toContain("No application with code");
      // must NOT have replied with the raw UID
      expect(arg.content).not.toBe("123456789");
    });

    it("replies with the UID only and logs an audit row when the app exists", async () => {
      asStaff();
      vi.mocked(findAppByShortCode).mockReturnValue({ id: "app-ABCDEF" } as never);

      const interaction = makeButtonInteraction("review:copy_uid:codeABCDEF:user123456789");
      await handleCopyUidButton(interaction as never);

      expect(interaction.reply).toHaveBeenCalledTimes(1);
      const arg = interaction.reply.mock.calls[0]![0] as { content: string };
      // mobile-copy convenience: content is exactly the UID, nothing else
      expect(arg.content).toBe("123456789");

      // audit trail INSERT into review_action
      expect(mockPrepare).toHaveBeenCalled();
      const insertedSql = mockPrepare.mock.calls.map((c) => c[0] as string);
      expect(insertedSql.some((s) => s.includes("INSERT INTO review_action"))).toBe(true);
      expect(mockRun).toHaveBeenCalledWith("app-ABCDEF", STAFF_USER, 1700000000);
    });
  });

  describe("handlePingInUnverified", () => {
    it("returns silently when the customId matches neither legacy nor modern pattern", async () => {
      const interaction = makeButtonInteraction("totally:unrelated");
      await handlePingInUnverified(interaction as never);
      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it("rejects a non-staff member with the Gatekeeper-required reply", async () => {
      // This handler responds via replyOrEdit (not interaction.reply directly).
      const interaction = makeButtonInteraction(
        "review:ping_unverified:codeABCDEF:user123456789",
        { guild: { channels: { fetch: vi.fn() } } }
      );
      await handlePingInUnverified(interaction as never);
      expect(replyOrEdit).toHaveBeenCalledTimes(1);
      const arg = vi.mocked(replyOrEdit).mock.calls[0]![1] as { content: string };
      expect(arg.content).toContain("Gatekeeper role required");
    });

    it("sends the ping with hardened allowedMentions (only the target user, parse [])", async () => {
      asStaff();
      vi.mocked(getConfig).mockReturnValue({ unverified_channel_id: "chan-1" } as never);

      const send = vi.fn().mockResolvedValue({ id: "msg-1" });
      const channel = {
        id: "chan-1",
        isTextBased: () => true,
        permissionsFor: () => ({ has: () => true }),
        send,
      };
      const guild = {
        channels: { fetch: vi.fn().mockResolvedValue(channel) },
        members: { me: { id: "bot-1" } },
      };

      const interaction = makeButtonInteraction(
        "review:ping_unverified:codeABCDEF:user123456789",
        { guild, channel }
      );
      await handlePingInUnverified(interaction as never);

      expect(send).toHaveBeenCalledTimes(1);
      const sent = send.mock.calls[0]![0] as {
        content: string;
        allowedMentions: { users: string[]; parse: string[] };
      };
      expect(sent.content).toBe("<@123456789>");
      // SECURITY: must restrict mentions to the single target user, no mass pings.
      expect(sent.allowedMentions.users).toEqual(["123456789"]);
      expect(sent.allowedMentions.parse).toEqual([]);
    });
  });

  describe("handleDeletePing", () => {
    it("returns silently on a non-matching customId", async () => {
      const interaction = makeButtonInteraction("not:a:delete:ping");
      await handleDeletePing(interaction as never);
      expect(interaction.reply).not.toHaveBeenCalled();
      expect(interaction.message.delete).not.toHaveBeenCalled();
    });

    it("rejects a non-staff member with the Gatekeeper-required reply", async () => {
      const interaction = makeButtonInteraction("v1:ping:delete:1234567890", {
        guild: {},
      });
      await handleDeletePing(interaction as never);
      expect(interaction.reply).toHaveBeenCalledTimes(1);
      const arg = interaction.reply.mock.calls[0]![0] as { content: string };
      expect(arg.content).toContain("Gatekeeper role required");
      expect(interaction.message.delete).not.toHaveBeenCalled();
    });

    it("deletes the message and acknowledges for a staff member", async () => {
      asStaff();
      const interaction = makeButtonInteraction("v1:ping:delete:1234567890", {
        guild: {},
      });
      await handleDeletePing(interaction as never);

      expect(interaction.message.delete).toHaveBeenCalledTimes(1);
      expect(interaction.reply).toHaveBeenCalledTimes(1);
      const arg = interaction.reply.mock.calls[0]![0] as { content: string };
      expect(arg.content).toBe("Ping deleted.");
    });
  });
});
