/**
 * Pawtropolis Tech — tests/features/review/handlers/helpers.test.ts
 * WHAT: Unit tests for review handler helper functions.
 * WHY: Verify staff checks, application resolution, and modal opening logic by
 *      exercising the REAL exported functions with mocked external boundaries
 *      (config, cmdWrap, claims, queries, appLookup, logger) - not by re-deriving
 *      the logic inline.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageFlags } from "discord.js";

vi.mock("../../../../src/lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../../src/lib/config.js", () => ({
  shouldBypass: vi.fn(() => false),
  hasRole: vi.fn(() => false),
  ROLE_IDS: {
    GATEKEEPER: "gatekeeper-role-id",
    ADMIN: "admin-role-id",
    LEADERSHIP: "leadership-role-id",
  },
}));

vi.mock("../../../../src/lib/cmdWrap.js", () => ({
  replyOrEdit: vi.fn().mockResolvedValue(undefined),
  ephemeralFollowUp: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/lib/ids.js", () => ({
  shortCode: vi.fn((id: string) => id.slice(-6).toUpperCase()),
}));

vi.mock("../../../../src/features/appLookup.js", () => ({
  findAppByShortCode: vi.fn(),
}));

vi.mock("../../../../src/features/review/claims.js", () => ({
  getClaim: vi.fn(),
  claimGuard: vi.fn(),
}));

vi.mock("../../../../src/features/review/queries.js", () => ({
  loadApplication: vi.fn(),
}));

import { shouldBypass, hasRole } from "../../../../src/lib/config.js";
import { replyOrEdit, ephemeralFollowUp } from "../../../../src/lib/cmdWrap.js";
import { findAppByShortCode } from "../../../../src/features/appLookup.js";
import { getClaim, claimGuard } from "../../../../src/features/review/claims.js";
import { loadApplication } from "../../../../src/features/review/queries.js";
import {
  BUTTON_RE,
  MODAL_RE,
  ACCEPT_MODAL_RE,
  isStaff,
  requireInteractionStaff,
  resolveApplication,
  openRejectModal,
  openAcceptModal,
  openPermRejectModal,
  openKickModal,
  openUnclaimModal,
} from "../../../../src/features/review/handlers/helpers.js";

// A minimal stand-in for a discord.js ButtonInteraction that exercises the real
// modal-opener code path. createdTimestamp is "now" so safeShowModal's token-age
// guard (>2500ms) does not trip; replied/deferred are false so the "already
// acked" guard does not trip either.
function makeButtonInteraction(overrides: Record<string, unknown> = {}) {
  return {
    id: "interaction-1",
    user: { id: "user123" },
    createdTimestamp: Date.now(),
    replied: false,
    deferred: false,
    showModal: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("features/review/handlers/helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isStaff", () => {
    describe("bypass checks", () => {
      it("returns true when shouldBypass returns true (short-circuits role check)", () => {
        vi.mocked(shouldBypass).mockReturnValue(true);
        vi.mocked(hasRole).mockReturnValue(false);

        const result = isStaff(null, "user123");

        expect(result).toBe(true);
        expect(shouldBypass).toHaveBeenCalledWith("user123", null);
        // Bypass wins before the role is ever consulted.
        expect(hasRole).not.toHaveBeenCalled();
      });

      it("returns false when not bypassed and no Gatekeeper role", () => {
        vi.mocked(shouldBypass).mockReturnValue(false);
        vi.mocked(hasRole).mockReturnValue(false);

        const result = isStaff(null, "user123");

        expect(result).toBe(false);
        expect(hasRole).toHaveBeenCalledWith(null, "gatekeeper-role-id");
      });
    });

    describe("Gatekeeper role check", () => {
      it("returns true when not bypassed but user has Gatekeeper role", () => {
        vi.mocked(shouldBypass).mockReturnValue(false);
        vi.mocked(hasRole).mockReturnValue(true);

        const member = { roles: { cache: new Map() } };
        const result = isStaff(member as never, "user123");

        expect(result).toBe(true);
        expect(hasRole).toHaveBeenCalledWith(member, "gatekeeper-role-id");
      });
    });
  });

  describe("requireInteractionStaff", () => {
    describe("guild validation", () => {
      it("rejects non-guild interactions and sends an ephemeral 'Guild only.' reply", () => {
        const reply = vi.fn().mockResolvedValue(undefined);
        const interaction = {
          id: "int-1",
          inGuild: () => false,
          guildId: null,
          user: { id: "user123" },
          member: null,
          reply,
        };

        const result = requireInteractionStaff(interaction as never);

        expect(result).toBe(false);
        expect(reply).toHaveBeenCalledTimes(1);
        expect(reply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral, content: "Guild only." });
        // Never even looks at staffing when the guild guard fails.
        expect(shouldBypass).not.toHaveBeenCalled();
      });

      it("rejects when inGuild is true but guildId is missing", () => {
        const reply = vi.fn().mockResolvedValue(undefined);
        const interaction = {
          id: "int-2",
          inGuild: () => true,
          guildId: null,
          user: { id: "user123" },
          member: null,
          reply,
        };

        const result = requireInteractionStaff(interaction as never);

        expect(result).toBe(false);
        expect(reply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral, content: "Guild only." });
      });
    });

    describe("permission validation", () => {
      it("rejects with the Gatekeeper notice when the member is not staff", () => {
        vi.mocked(shouldBypass).mockReturnValue(false);
        vi.mocked(hasRole).mockReturnValue(false);
        const reply = vi.fn().mockResolvedValue(undefined);
        const interaction = {
          id: "int-3",
          inGuild: () => true,
          guildId: "guild123",
          user: { id: "user123" },
          member: { roles: { cache: new Map() } },
          reply,
        };

        const result = requireInteractionStaff(interaction as never);

        expect(result).toBe(false);
        expect(reply).toHaveBeenCalledWith({
          flags: MessageFlags.Ephemeral,
          content: "You do not have the Gatekeeper role required for this action.",
        });
      });

      it("allows (returns true, no reply) when the member is staff", () => {
        vi.mocked(shouldBypass).mockReturnValue(false);
        vi.mocked(hasRole).mockReturnValue(true);
        const reply = vi.fn().mockResolvedValue(undefined);
        const interaction = {
          id: "int-4",
          inGuild: () => true,
          guildId: "guild123",
          user: { id: "user123" },
          member: { roles: { cache: new Map([["gatekeeper-role-id", {}]]) } },
          reply,
        };

        const result = requireInteractionStaff(interaction as never);

        expect(result).toBe(true);
        expect(reply).not.toHaveBeenCalled();
      });
    });
  });

  describe("resolveApplication", () => {
    function makeResolveInteraction(overrides: Record<string, unknown> = {}) {
      return {
        id: "int-resolve",
        guildId: "guild123",
        deferred: false,
        replied: false,
        ...overrides,
      };
    }

    describe("guild validation", () => {
      it("returns null and replies 'Guild only.' when guildId is missing", async () => {
        const interaction = makeResolveInteraction({ guildId: null });

        const result = await resolveApplication(interaction as never, "ABCDEF");

        expect(result).toBeNull();
        expect(replyOrEdit).toHaveBeenCalledWith(interaction, {
          content: "Guild only.",
          flags: MessageFlags.Ephemeral,
        });
        // Never looks anything up once the guild guard fails.
        expect(findAppByShortCode).not.toHaveBeenCalled();
      });
    });

    describe("application lookup", () => {
      it("returns null and reports the missing code when no row is found", async () => {
        vi.mocked(findAppByShortCode).mockReturnValue(null);
        const interaction = makeResolveInteraction();

        const result = await resolveApplication(interaction as never, "ABCDEF");

        expect(result).toBeNull();
        expect(findAppByShortCode).toHaveBeenCalledWith("guild123", "ABCDEF");
        expect(replyOrEdit).toHaveBeenCalledWith(interaction, {
          content: "No application with code ABCDEF.",
          flags: MessageFlags.Ephemeral,
        });
        expect(loadApplication).not.toHaveBeenCalled();
      });

      it("returns null and reports 'Application not found.' when loadApplication returns null", async () => {
        vi.mocked(findAppByShortCode).mockReturnValue({ id: "app-123" } as never);
        vi.mocked(loadApplication).mockReturnValue(null as never);
        const interaction = makeResolveInteraction();

        const result = await resolveApplication(interaction as never, "ABCDEF");

        expect(result).toBeNull();
        expect(loadApplication).toHaveBeenCalledWith("app-123");
        expect(replyOrEdit).toHaveBeenCalledWith(interaction, {
          content: "Application not found.",
          flags: MessageFlags.Ephemeral,
        });
      });
    });

    describe("guild-match authz guard", () => {
      it("returns null and reports a guild mismatch when app.guild_id differs", async () => {
        vi.mocked(findAppByShortCode).mockReturnValue({ id: "app-123" } as never);
        vi.mocked(loadApplication).mockReturnValue({ id: "app-123", guild_id: "guild456" } as never);
        const interaction = makeResolveInteraction({ guildId: "guild123" });

        const result = await resolveApplication(interaction as never, "ABCDEF");

        expect(result).toBeNull();
        expect(replyOrEdit).toHaveBeenCalledWith(interaction, {
          content: "Guild mismatch for application.",
          flags: MessageFlags.Ephemeral,
        });
      });

      it("returns the app (no reply) when the guild matches", async () => {
        const app = { id: "app-123", guild_id: "guild123", user_id: "u1", status: "submitted" };
        vi.mocked(findAppByShortCode).mockReturnValue({ id: "app-123" } as never);
        vi.mocked(loadApplication).mockReturnValue(app as never);
        const interaction = makeResolveInteraction({ guildId: "guild123" });

        const result = await resolveApplication(interaction as never, "ABCDEF");

        expect(result).toEqual(app);
        expect(replyOrEdit).not.toHaveBeenCalled();
        expect(ephemeralFollowUp).not.toHaveBeenCalled();
      });
    });

    describe("post-ack failure path", () => {
      it("uses ephemeralFollowUp (not replyOrEdit) when the interaction is already deferred", async () => {
        vi.mocked(findAppByShortCode).mockReturnValue(null);
        const interaction = makeResolveInteraction({ deferred: true });

        const result = await resolveApplication(interaction as never, "ABCDEF");

        expect(result).toBeNull();
        expect(ephemeralFollowUp).toHaveBeenCalledWith(interaction, "No application with code ABCDEF.");
        expect(replyOrEdit).not.toHaveBeenCalled();
      });
    });
  });
});

describe("BUTTON_RE pattern", () => {
  // BUTTON_RE is the real exported pattern (BTN_DECIDE_RE), not a local copy.
  describe("valid patterns", () => {
    it("matches approve button", () => {
      const customId = "v1:decide:approve:codeABCDEF";
      const match = BUTTON_RE.exec(customId);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe("approve");
      expect(match?.[2]).toBe("ABCDEF");
    });

    it("matches the legacy review: prefix alias", () => {
      const customId = "review:approve:codeABCDEF";
      const match = BUTTON_RE.exec(customId);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe("approve");
    });

    it("matches reject button", () => {
      const customId = "v1:decide:reject:code123456";
      const match = BUTTON_RE.exec(customId);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe("reject");
      expect(match?.[2]).toBe("123456");
    });

    it("matches kick button", () => {
      const customId = "v1:decide:kick:codeFEDCBA";
      const match = BUTTON_RE.exec(customId);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe("kick");
    });

    it("matches claim button", () => {
      const customId = "v1:decide:claim:code000000";
      const match = BUTTON_RE.exec(customId);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe("claim");
    });

    it("matches unclaim button", () => {
      const customId = "v1:decide:unclaim:codeFFFFF0";
      const match = BUTTON_RE.exec(customId);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe("unclaim");
    });
  });

  describe("invalid patterns", () => {
    it("rejects lowercase hex codes", () => {
      const customId = "v1:decide:approve:codeabcdef";
      const match = BUTTON_RE.exec(customId);
      expect(match).toBeNull();
    });

    it("rejects short codes", () => {
      const customId = "v1:decide:approve:codeABCDE";
      const match = BUTTON_RE.exec(customId);
      expect(match).toBeNull();
    });

    it("rejects long codes", () => {
      const customId = "v1:decide:approve:codeABCDEF0";
      const match = BUTTON_RE.exec(customId);
      expect(match).toBeNull();
    });

    it("rejects missing prefix", () => {
      const customId = "decide:approve:codeABCDEF";
      const match = BUTTON_RE.exec(customId);
      expect(match).toBeNull();
    });

    it("rejects actions outside the allowlist", () => {
      const customId = "v1:decide:bogus:codeABCDEF";
      const match = BUTTON_RE.exec(customId);
      expect(match).toBeNull();
    });
  });
});

describe("MODAL_RE pattern", () => {
  // Real exported reject-modal pattern (MODAL_REJECT_RE), not an inline copy.
  describe("valid patterns", () => {
    it("matches reject modal", () => {
      const customId = "v1:modal:reject:codeABCDEF";
      const match = MODAL_RE.exec(customId);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe("ABCDEF");
    });
  });

  describe("invalid patterns", () => {
    it("rejects accept modal ID", () => {
      const customId = "v1:modal:accept:codeABCDEF";
      const match = MODAL_RE.exec(customId);
      expect(match).toBeNull();
    });
  });
});

describe("ACCEPT_MODAL_RE pattern", () => {
  // Real exported accept-modal pattern (MODAL_ACCEPT_RE), not an inline copy.
  describe("valid patterns", () => {
    it("matches accept modal", () => {
      const customId = "v1:modal:accept:code123456";
      const match = ACCEPT_MODAL_RE.exec(customId);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe("123456");
    });
  });

  describe("invalid patterns", () => {
    it("rejects reject modal ID", () => {
      const customId = "v1:modal:reject:code123456";
      const match = ACCEPT_MODAL_RE.exec(customId);
      expect(match).toBeNull();
    });
  });
});

describe("modal opening functions", () => {
  const PENDING_APP = { id: "app-ABCDEF", guild_id: "guild123", user_id: "u1", status: "submitted" };

  beforeEach(() => {
    // Default: unclaimed, claim guard passes.
    vi.mocked(getClaim).mockReturnValue(null);
    vi.mocked(claimGuard).mockReturnValue(null);
  });

  describe("openRejectModal", () => {
    it("shows a modal with the reject customId for a pending application", async () => {
      const interaction = makeButtonInteraction();

      await openRejectModal(interaction as never, PENDING_APP as never);

      expect(interaction.showModal).toHaveBeenCalledTimes(1);
      const modal = interaction.showModal.mock.calls[0][0];
      expect(modal.data.custom_id).toBe("v1:modal:reject:codeABCDEF");
      expect(replyOrEdit).not.toHaveBeenCalled();
    });

    it("blocks already-resolved applications without showing a modal", async () => {
      const interaction = makeButtonInteraction();

      await openRejectModal(interaction as never, { ...PENDING_APP, status: "approved" } as never);

      expect(interaction.showModal).not.toHaveBeenCalled();
      expect(replyOrEdit).toHaveBeenCalledWith(interaction, {
        content: "This application is already resolved.",
        flags: MessageFlags.Ephemeral,
      });
    });

    it("blocks and surfaces the claim error when claimGuard fails", async () => {
      vi.mocked(getClaim).mockReturnValue({ app_id: "app-ABCDEF", reviewer_id: "other", claimed_at: "0" });
      vi.mocked(claimGuard).mockReturnValue("Not your claim");
      const interaction = makeButtonInteraction();

      await openRejectModal(interaction as never, PENDING_APP as never);

      expect(interaction.showModal).not.toHaveBeenCalled();
      expect(claimGuard).toHaveBeenCalledWith({ app_id: "app-ABCDEF", reviewer_id: "other", claimed_at: "0" }, "user123");
      expect(replyOrEdit).toHaveBeenCalledWith(interaction, {
        content: "Not your claim",
        flags: MessageFlags.Ephemeral,
      });
    });
  });

  describe("openAcceptModal", () => {
    it("shows a modal with the accept customId for a pending application", async () => {
      const interaction = makeButtonInteraction();

      await openAcceptModal(interaction as never, PENDING_APP as never);

      expect(interaction.showModal).toHaveBeenCalledTimes(1);
      const modal = interaction.showModal.mock.calls[0][0];
      expect(modal.data.custom_id).toBe("v1:modal:accept:codeABCDEF");
    });

    it("blocks rejected applications", async () => {
      const interaction = makeButtonInteraction();

      await openAcceptModal(interaction as never, { ...PENDING_APP, status: "rejected" } as never);

      expect(interaction.showModal).not.toHaveBeenCalled();
      expect(replyOrEdit).toHaveBeenCalledWith(interaction, {
        content: "This application is already resolved.",
        flags: MessageFlags.Ephemeral,
      });
    });

    it("blocks kicked applications", async () => {
      const interaction = makeButtonInteraction();

      await openAcceptModal(interaction as never, { ...PENDING_APP, status: "kicked" } as never);

      expect(interaction.showModal).not.toHaveBeenCalled();
      expect(replyOrEdit).toHaveBeenCalledWith(interaction, {
        content: "This application is already resolved.",
        flags: MessageFlags.Ephemeral,
      });
    });
  });

  describe("openPermRejectModal", () => {
    it("shows a modal with the permreject customId when unclaimed", async () => {
      vi.mocked(getClaim).mockReturnValue(null);
      const interaction = makeButtonInteraction();

      await openPermRejectModal(interaction as never, PENDING_APP as never);

      expect(interaction.showModal).toHaveBeenCalledTimes(1);
      const modal = interaction.showModal.mock.calls[0][0];
      expect(modal.data.custom_id).toBe("v1:modal:permreject:codeABCDEF");
    });

    it("blocks when claimed by another user", async () => {
      vi.mocked(getClaim).mockReturnValue({ app_id: "app-ABCDEF", reviewer_id: "user456", claimed_at: "0" });
      const interaction = makeButtonInteraction();

      await openPermRejectModal(interaction as never, PENDING_APP as never);

      expect(interaction.showModal).not.toHaveBeenCalled();
      expect(replyOrEdit).toHaveBeenCalledWith(interaction, {
        content: "You did not claim this application.",
        flags: MessageFlags.Ephemeral,
      });
    });

    it("allows when claimed by the same user", async () => {
      vi.mocked(getClaim).mockReturnValue({ app_id: "app-ABCDEF", reviewer_id: "user123", claimed_at: "0" });
      const interaction = makeButtonInteraction();

      await openPermRejectModal(interaction as never, PENDING_APP as never);

      expect(interaction.showModal).toHaveBeenCalledTimes(1);
      expect(replyOrEdit).not.toHaveBeenCalled();
    });
  });

  describe("openKickModal", () => {
    it("shows a modal with the kick customId for a pending application", async () => {
      const interaction = makeButtonInteraction();

      await openKickModal(interaction as never, PENDING_APP as never);

      expect(interaction.showModal).toHaveBeenCalledTimes(1);
      const modal = interaction.showModal.mock.calls[0][0];
      expect(modal.data.custom_id).toBe("v1:modal:kick:codeABCDEF");
    });

    it("blocks already-approved applications", async () => {
      const interaction = makeButtonInteraction();

      await openKickModal(interaction as never, { ...PENDING_APP, status: "approved" } as never);

      expect(interaction.showModal).not.toHaveBeenCalled();
      expect(replyOrEdit).toHaveBeenCalledWith(interaction, {
        content: "This application is already resolved.",
        flags: MessageFlags.Ephemeral,
      });
    });
  });

  describe("openUnclaimModal", () => {
    it("shows a modal with the unclaim customId when claimed by the same user", async () => {
      vi.mocked(getClaim).mockReturnValue({ app_id: "app-ABCDEF", reviewer_id: "user123", claimed_at: "0" });
      const interaction = makeButtonInteraction();

      await openUnclaimModal(interaction as never, PENDING_APP as never);

      expect(interaction.showModal).toHaveBeenCalledTimes(1);
      const modal = interaction.showModal.mock.calls[0][0];
      expect(modal.data.custom_id).toBe("v1:modal:unclaim:codeABCDEF");
    });

    it("blocks when the application is not claimed", async () => {
      vi.mocked(getClaim).mockReturnValue(null);
      const interaction = makeButtonInteraction();

      await openUnclaimModal(interaction as never, PENDING_APP as never);

      expect(interaction.showModal).not.toHaveBeenCalled();
      expect(replyOrEdit).toHaveBeenCalledWith(interaction, {
        content: "This application is not currently claimed.",
        flags: MessageFlags.Ephemeral,
      });
    });

    it("blocks when claimed by another user", async () => {
      vi.mocked(getClaim).mockReturnValue({ app_id: "app-ABCDEF", reviewer_id: "user456", claimed_at: "0" });
      const interaction = makeButtonInteraction();

      await openUnclaimModal(interaction as never, PENDING_APP as never);

      expect(interaction.showModal).not.toHaveBeenCalled();
      expect(replyOrEdit).toHaveBeenCalledWith(interaction, {
        content: "You did not claim this application. Only the claim owner can unclaim it.",
        flags: MessageFlags.Ephemeral,
      });
    });
  });
});
