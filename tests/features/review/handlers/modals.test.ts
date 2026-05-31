/**
 * Pawtropolis Tech — tests/features/review/handlers/modals.test.ts
 * WHAT: Unit tests for review modal submission handlers.
 * WHY: Verify modal pattern matching, input parsing, staff gating, and action dispatching
 *      by driving the REAL handlers in src/features/review/handlers/modals.ts.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModalSubmitInteraction } from "discord.js";

// Real regexes from the source of truth, used to build canonical customIds in tests.
import {
  MODAL_REJECT_RE,
  MODAL_ACCEPT_RE,
  MODAL_PERM_REJECT_RE,
  MODAL_KICK_RE,
  MODAL_UNCLAIM_RE,
} from "../../../../src/lib/modalPatterns.js";

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

vi.mock("../../../../src/lib/cmdWrap.js", () => ({
  ephemeralFollowUp: vi.fn().mockResolvedValue(undefined),
}));

// reqctx is mocked so the trace id used in catch blocks is deterministic. This lets
// us assert the REAL derivation (ctx().traceId ?? newTraceId()) instead of a literal.
vi.mock("../../../../src/lib/reqctx.js", () => ({
  ctx: vi.fn(() => ({})),
  newTraceId: vi.fn(() => "TRACE12345A"),
}));

// helpers.js is mocked at the genuine boundary: requireInteractionStaff and
// resolveApplication are the gates the handler delegates to. MODAL_RE / ACCEPT_MODAL_RE
// re-export the REAL canonical patterns so matching is not re-implemented.
vi.mock("../../../../src/features/review/handlers/helpers.js", async () => {
  const patterns = await vi.importActual<typeof import("../../../../src/lib/modalPatterns.js")>(
    "../../../../src/lib/modalPatterns.js"
  );
  return {
    MODAL_RE: patterns.MODAL_REJECT_RE,
    ACCEPT_MODAL_RE: patterns.MODAL_ACCEPT_RE,
    requireInteractionStaff: vi.fn(() => true),
    resolveApplication: vi.fn(),
  };
});

vi.mock("../../../../src/features/review/handlers/actionRunners.js", () => ({
  runApproveAction: vi.fn().mockResolvedValue(undefined),
  runRejectAction: vi.fn().mockResolvedValue(undefined),
  runPermRejectAction: vi.fn().mockResolvedValue(undefined),
  runKickAction: vi.fn().mockResolvedValue(undefined),
  runVoteOutAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/features/review/handlers/claimHandlers.js", () => ({
  handleUnclaimAction: vi.fn().mockResolvedValue(undefined),
}));

import {
  handleRejectModal,
  handleAcceptModal,
  handlePermRejectModal,
  handleKickModal,
  handleUnclaimModal,
} from "../../../../src/features/review/handlers/modals.js";
import { ephemeralFollowUp } from "../../../../src/lib/cmdWrap.js";
import { captureException } from "../../../../src/lib/sentry.js";
import { logger } from "../../../../src/lib/logger.js";
import { requireInteractionStaff, resolveApplication } from "../../../../src/features/review/handlers/helpers.js";
import {
  runApproveAction,
  runRejectAction,
  runPermRejectAction,
  runKickAction,
} from "../../../../src/features/review/handlers/actionRunners.js";
import { handleUnclaimAction } from "../../../../src/features/review/handlers/claimHandlers.js";

const APP = { id: "app-1", guild_id: "guild-1", user_id: "user-1", status: "pending" };

/**
 * Build a minimal ModalSubmitInteraction stub. fieldValues maps the modal field
 * customId to the raw text input value the handler will read.
 */
function makeInteraction(
  customId: string,
  fieldValues: Record<string, string> = {}
): ModalSubmitInteraction {
  const deferUpdate = vi.fn().mockResolvedValue(undefined);
  return {
    id: "interaction-XYZ987654321",
    customId,
    deferred: false,
    replied: false,
    inGuild: () => true,
    guildId: "guild-1",
    user: { id: "staff-1", username: "staff" },
    deferUpdate,
    fields: {
      getTextInputValue: vi.fn((id: string) => {
        if (id in fieldValues) return fieldValues[id];
        return "";
      }),
    },
  } as unknown as ModalSubmitInteraction;
}

describe("features/review/handlers/modals (real handlers)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireInteractionStaff).mockReturnValue(true);
    vi.mocked(resolveApplication).mockResolvedValue(APP as never);
  });

  describe("handleRejectModal", () => {
    it("matches the canonical reject customId, defers, and dispatches runRejectAction with trimmed/truncated reason", async () => {
      const code = "ABCDEF";
      const interaction = makeInteraction(`v1:modal:reject:code${code}`, {
        "v1:modal:reject:reason": "  User is banned  ",
      });

      await handleRejectModal(interaction);

      expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
      expect(resolveApplication).toHaveBeenCalledWith(interaction, code);
      expect(runRejectAction).toHaveBeenCalledWith(interaction, APP, "User is banned");
    });

    it("truncates reject reason to 500 chars (string, never null)", async () => {
      const interaction = makeInteraction("v1:modal:reject:codeABCDEF", {
        "v1:modal:reject:reason": "a".repeat(600),
      });

      await handleRejectModal(interaction);

      const reason = vi.mocked(runRejectAction).mock.calls[0]![2] as string;
      expect(reason).toHaveLength(500);
    });

    it("reads the reason from the v1:modal:reject:reason field", async () => {
      const interaction = makeInteraction("v1:modal:reject:codeABCDEF", {
        "v1:modal:reject:reason": "from correct field",
      });

      await handleRejectModal(interaction);

      expect(interaction.fields.getTextInputValue).toHaveBeenCalledWith("v1:modal:reject:reason");
      expect(runRejectAction).toHaveBeenCalledWith(interaction, APP, "from correct field");
    });

    it("early-returns on a non-matching customId without deferring or dispatching", async () => {
      const interaction = makeInteraction("v1:modal:accept:codeABCDEF");

      await handleRejectModal(interaction);

      expect(interaction.deferUpdate).not.toHaveBeenCalled();
      expect(requireInteractionStaff).not.toHaveBeenCalled();
      expect(resolveApplication).not.toHaveBeenCalled();
      expect(runRejectAction).not.toHaveBeenCalled();
    });

    it("early-returns (no dispatch) when the staff check fails", async () => {
      vi.mocked(requireInteractionStaff).mockReturnValue(false);
      const interaction = makeInteraction("v1:modal:reject:codeABCDEF");

      await handleRejectModal(interaction);

      expect(requireInteractionStaff).toHaveBeenCalledWith(interaction);
      expect(interaction.deferUpdate).not.toHaveBeenCalled();
      expect(resolveApplication).not.toHaveBeenCalled();
      expect(runRejectAction).not.toHaveBeenCalled();
    });

    it("early-returns when resolveApplication yields no application", async () => {
      vi.mocked(resolveApplication).mockResolvedValue(null);
      const interaction = makeInteraction("v1:modal:reject:codeABCDEF");

      await handleRejectModal(interaction);

      expect(resolveApplication).toHaveBeenCalled();
      expect(runRejectAction).not.toHaveBeenCalled();
    });

    it("on error, reports to Sentry/logs and replies with the trace id from newTraceId()", async () => {
      vi.mocked(resolveApplication).mockRejectedValue(new Error("boom"));
      const interaction = makeInteraction("v1:modal:reject:codeABCDEF");

      await handleRejectModal(interaction);

      // Trace id is the value newTraceId() returns, NOT a slice of interaction.id.
      expect(captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ area: "handleRejectModal", code: "ABCDEF", traceId: "TRACE12345A" })
      );
      expect(logger.error).toHaveBeenCalled();
      expect(ephemeralFollowUp).toHaveBeenCalledWith(
        interaction,
        "Failed to process rejection (trace: TRACE12345A)."
      );
    });
  });

  describe("handleAcceptModal", () => {
    it("matches accept customId and dispatches runApproveAction with trimmed reason", async () => {
      const interaction = makeInteraction("v1:modal:accept:code123456", {
        "v1:modal:accept:reason": "  Welcome to the server!  ",
      });

      await handleAcceptModal(interaction);

      expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
      expect(resolveApplication).toHaveBeenCalledWith(interaction, "123456");
      expect(runApproveAction).toHaveBeenCalledWith(interaction, APP, "Welcome to the server!");
    });

    it("dispatches null reason when the accept field is empty/whitespace", async () => {
      const interaction = makeInteraction("v1:modal:accept:code123456", {
        "v1:modal:accept:reason": "   ",
      });

      await handleAcceptModal(interaction);

      expect(runApproveAction).toHaveBeenCalledWith(interaction, APP, null);
    });

    it("truncates accept reason to 500 chars", async () => {
      const interaction = makeInteraction("v1:modal:accept:code123456", {
        "v1:modal:accept:reason": "b".repeat(600),
      });

      await handleAcceptModal(interaction);

      const reason = vi.mocked(runApproveAction).mock.calls[0]![2] as string;
      expect(reason).toHaveLength(500);
    });

    it("reads the reason from the v1:modal:accept:reason field", async () => {
      const interaction = makeInteraction("v1:modal:accept:code123456", {
        "v1:modal:accept:reason": "note",
      });

      await handleAcceptModal(interaction);

      expect(interaction.fields.getTextInputValue).toHaveBeenCalledWith("v1:modal:accept:reason");
    });

    it("early-returns on a non-matching customId", async () => {
      const interaction = makeInteraction("v1:modal:reject:code123456");

      await handleAcceptModal(interaction);

      expect(resolveApplication).not.toHaveBeenCalled();
      expect(runApproveAction).not.toHaveBeenCalled();
    });
  });

  describe("handlePermRejectModal", () => {
    it("matches permreject customId and dispatches runPermRejectAction with trimmed reason", async () => {
      const interaction = makeInteraction("v1:modal:permreject:codeFEDCBA", {
        "v1:modal:permreject:reason": "  Permanent ban for repeated violations  ",
      });

      await handlePermRejectModal(interaction);

      expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
      expect(resolveApplication).toHaveBeenCalledWith(interaction, "FEDCBA");
      expect(runPermRejectAction).toHaveBeenCalledWith(
        interaction,
        APP,
        "Permanent ban for repeated violations"
      );
    });

    it("reads the reason from the v1:modal:permreject:reason field (string, not null)", async () => {
      const interaction = makeInteraction("v1:modal:permreject:codeFEDCBA", {
        "v1:modal:permreject:reason": "reason text",
      });

      await handlePermRejectModal(interaction);

      expect(interaction.fields.getTextInputValue).toHaveBeenCalledWith("v1:modal:permreject:reason");
      expect(runPermRejectAction).toHaveBeenCalledWith(interaction, APP, "reason text");
    });

    it("early-returns on a non-matching customId", async () => {
      const interaction = makeInteraction("v1:modal:kick:codeFEDCBA");

      await handlePermRejectModal(interaction);

      expect(resolveApplication).not.toHaveBeenCalled();
      expect(runPermRejectAction).not.toHaveBeenCalled();
    });
  });

  describe("handleKickModal", () => {
    it("matches kick customId and dispatches runKickAction with the reason", async () => {
      const interaction = makeInteraction("v1:modal:kick:code000FFF", {
        "v1:modal:kick:reason": "Spamming in unverified",
      });

      await handleKickModal(interaction);

      expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
      expect(resolveApplication).toHaveBeenCalledWith(interaction, "000FFF");
      expect(runKickAction).toHaveBeenCalledWith(interaction, APP, "Spamming in unverified");
    });

    it("dispatches null reason when the kick field is empty (optional)", async () => {
      const interaction = makeInteraction("v1:modal:kick:code000FFF", {
        "v1:modal:kick:reason": "",
      });

      await handleKickModal(interaction);

      expect(runKickAction).toHaveBeenCalledWith(interaction, APP, null);
    });

    it("reads the reason from the v1:modal:kick:reason field", async () => {
      const interaction = makeInteraction("v1:modal:kick:code000FFF", {
        "v1:modal:kick:reason": "some reason",
      });

      await handleKickModal(interaction);

      expect(interaction.fields.getTextInputValue).toHaveBeenCalledWith("v1:modal:kick:reason");
    });

    it("early-returns on a non-matching customId", async () => {
      const interaction = makeInteraction("v1:modal:unclaim:code000FFF");

      await handleKickModal(interaction);

      expect(resolveApplication).not.toHaveBeenCalled();
      expect(runKickAction).not.toHaveBeenCalled();
    });
  });

  describe("handleUnclaimModal", () => {
    it("matches unclaim customId and dispatches handleUnclaimAction when confirm is UNCLAIM", async () => {
      const interaction = makeInteraction("v1:modal:unclaim:codeAAAAAA", {
        "v1:modal:unclaim:confirm": "unclaim",
      });

      await handleUnclaimModal(interaction);

      expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
      expect(resolveApplication).toHaveBeenCalledWith(interaction, "AAAAAA");
      // Confirm text is uppercased before comparison, so lowercase "unclaim" passes.
      expect(handleUnclaimAction).toHaveBeenCalledWith(interaction, APP);
      expect(ephemeralFollowUp).not.toHaveBeenCalled();
    });

    it("cancels (no unclaim) when confirmation text does not match UNCLAIM", async () => {
      const interaction = makeInteraction("v1:modal:unclaim:codeAAAAAA", {
        "v1:modal:unclaim:confirm": "CANCEL",
      });

      await handleUnclaimModal(interaction);

      expect(handleUnclaimAction).not.toHaveBeenCalled();
      expect(ephemeralFollowUp).toHaveBeenCalledWith(
        interaction,
        "Unclaim cancelled. You must type `UNCLAIM` to confirm."
      );
    });

    it("cancels on empty confirmation", async () => {
      const interaction = makeInteraction("v1:modal:unclaim:codeAAAAAA", {
        "v1:modal:unclaim:confirm": "",
      });

      await handleUnclaimModal(interaction);

      expect(handleUnclaimAction).not.toHaveBeenCalled();
      expect(ephemeralFollowUp).toHaveBeenCalled();
    });

    it("reads confirmation from the v1:modal:unclaim:confirm field", async () => {
      const interaction = makeInteraction("v1:modal:unclaim:codeAAAAAA", {
        "v1:modal:unclaim:confirm": "UNCLAIM",
      });

      await handleUnclaimModal(interaction);

      expect(interaction.fields.getTextInputValue).toHaveBeenCalledWith("v1:modal:unclaim:confirm");
    });

    it("early-returns on a non-matching customId", async () => {
      const interaction = makeInteraction("v1:modal:reject:codeAAAAAA");

      await handleUnclaimModal(interaction);

      expect(resolveApplication).not.toHaveBeenCalled();
      expect(handleUnclaimAction).not.toHaveBeenCalled();
    });
  });

  describe("deferUpdate gating", () => {
    it("does not call deferUpdate when the interaction is already replied/deferred", async () => {
      const interaction = makeInteraction("v1:modal:reject:codeABCDEF", {
        "v1:modal:reject:reason": "x",
      });
      (interaction as unknown as { replied: boolean }).replied = true;

      await handleRejectModal(interaction);

      expect(interaction.deferUpdate).not.toHaveBeenCalled();
      // Still dispatches the action even though it did not re-acknowledge.
      expect(runRejectAction).toHaveBeenCalled();
    });
  });
});

describe("modal customId patterns (canonical source-of-truth regexes)", () => {
  it("MODAL_REJECT_RE captures the 6-char hex code", () => {
    const match = MODAL_REJECT_RE.exec("v1:modal:reject:codeABCDEF");
    expect(match?.[1]).toBe("ABCDEF");
    expect(MODAL_REJECT_RE.exec("v1:modal:accept:codeABCDEF")).toBeNull();
  });

  it("MODAL_ACCEPT_RE captures the 6-char hex code", () => {
    const match = MODAL_ACCEPT_RE.exec("v1:modal:accept:code123456");
    expect(match?.[1]).toBe("123456");
  });

  it("MODAL_PERM_REJECT_RE captures the 6-char hex code", () => {
    const match = MODAL_PERM_REJECT_RE.exec("v1:modal:permreject:codeFEDCBA");
    expect(match?.[1]).toBe("FEDCBA");
  });

  it("MODAL_KICK_RE captures the 6-char hex code", () => {
    const match = MODAL_KICK_RE.exec("v1:modal:kick:code000FFF");
    expect(match?.[1]).toBe("000FFF");
  });

  it("MODAL_UNCLAIM_RE captures the 6-char hex code", () => {
    const match = MODAL_UNCLAIM_RE.exec("v1:modal:unclaim:codeAAAAAA");
    expect(match?.[1]).toBe("AAAAAA");
  });

  it("rejects lowercase hex codes", () => {
    expect(MODAL_REJECT_RE.exec("v1:modal:reject:codeabcdef")).toBeNull();
  });
});
