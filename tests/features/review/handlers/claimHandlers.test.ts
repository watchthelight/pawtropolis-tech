/**
 * Pawtropolis Tech — tests/features/review/handlers/claimHandlers.test.ts
 * WHAT: Unit tests for review claim/unclaim handlers.
 * WHY: Verify atomic claim operations, ClaimError mapping, and side effects.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Everything referenced inside a `vi.mock` factory must live in a hoisted block,
// because vi.mock calls are lifted above all other top-level code. ClaimError is a
// REAL class here so the handler's `instanceof` check matches the same constructor
// the dynamic import resolves to.
const {
  mockGet,
  mockAll,
  mockRun,
  mockPrepare,
  mockClaimTx,
  mockUnclaimTx,
  ClaimError,
  mockEphemeralFollowUp,
  mockLogActionPretty,
  mockEnsureReviewMessage,
  mockCacheUser,
  mockNotifyDashboard,
} = vi.hoisted(() => {
  class ClaimError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = "ClaimError";
      this.code = code;
    }
  }
  return {
    mockGet: vi.fn(),
    mockAll: vi.fn(),
    mockRun: vi.fn(),
    mockPrepare: vi.fn(),
    mockClaimTx: vi.fn(),
    mockUnclaimTx: vi.fn(),
    ClaimError,
    mockEphemeralFollowUp: vi.fn().mockResolvedValue(undefined),
    mockLogActionPretty: vi.fn().mockResolvedValue(undefined),
    mockEnsureReviewMessage: vi.fn().mockResolvedValue({ messageId: "msg-123" }),
    mockCacheUser: vi.fn(),
    mockNotifyDashboard: vi.fn(),
  };
});

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

vi.mock("../../../../src/lib/cmdWrap.js", () => ({
  ephemeralFollowUp: mockEphemeralFollowUp,
}));

vi.mock("../../../../src/lib/ids.js", () => ({
  shortCode: vi.fn((id: string) => id.slice(-6).toUpperCase()),
}));

vi.mock("../../../../src/logging/pretty.js", () => ({
  logActionPretty: mockLogActionPretty,
}));

vi.mock("../../../../src/features/review.js", () => ({
  ensureReviewMessage: mockEnsureReviewMessage,
}));

vi.mock("../../../../src/lib/userCache.js", () => ({
  cacheUser: mockCacheUser,
}));

vi.mock("../../../../src/web/notifyDashboard.js", () => ({
  notifyDashboard: mockNotifyDashboard,
}));

// The handlers dynamically import this module; provide a real ClaimError class plus
// controllable claimTx/unclaimTx so we exercise the actual error-mapping branches.
vi.mock("../../../../src/features/reviewActions.js", () => ({
  claimTx: mockClaimTx,
  unclaimTx: mockUnclaimTx,
  ClaimError,
}));

import {
  handleClaimToggle,
  handleUnclaimAction,
} from "../../../../src/features/review/handlers/claimHandlers.js";

type AppRow = {
  id: string;
  guild_id: string;
  user_id: string;
  status: string;
};

const APP: AppRow = {
  id: "application-7-abc123",
  guild_id: "guild-1",
  user_id: "applicant-42",
  status: "submitted",
};

function makeInteraction(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: "moderator-99" },
    member: { displayAvatarURL: () => "https://cdn/avatar.png" },
    guild: { id: "guild-1", name: "Pawtropolis" },
    client: {},
    followUp: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrepare.mockReturnValue({
    get: mockGet,
    all: mockAll,
    run: mockRun,
  });
  // Default: success transactions, user not permanently rejected.
  mockClaimTx.mockReset();
  mockUnclaimTx.mockReset();
  mockGet.mockReturnValue(undefined);
  mockEphemeralFollowUp.mockResolvedValue(undefined);
  mockLogActionPretty.mockResolvedValue(undefined);
  mockEnsureReviewMessage.mockResolvedValue({ messageId: "msg-123" });
});

describe("features/review/handlers/claimHandlers", () => {
  describe("handleClaimToggle", () => {
    describe("ClaimError handling", () => {
      it("maps ALREADY_CLAIMED to a user-friendly message and skips side effects", async () => {
        mockClaimTx.mockImplementation(() => {
          throw new ClaimError("Application already claimed by <@other>", "ALREADY_CLAIMED");
        });

        await handleClaimToggle(makeInteraction(), APP as never);

        expect(mockEphemeralFollowUp).toHaveBeenCalledTimes(1);
        expect(mockEphemeralFollowUp.mock.calls[0][1]).toBe(
          "This application is already claimed by another moderator."
        );
        // Error path must not run success side effects.
        expect(mockLogActionPretty).not.toHaveBeenCalled();
        expect(mockNotifyDashboard).not.toHaveBeenCalled();
        // Permanent-rejection re-check should not run when the claim itself failed.
        expect(mockGet).not.toHaveBeenCalled();
      });

      it("maps INVALID_STATUS terminal state, embeds the status word, and refreshes the card", async () => {
        mockClaimTx.mockImplementation(() => {
          throw new ClaimError("Application already approved", "INVALID_STATUS");
        });

        await handleClaimToggle(makeInteraction(), APP as never);

        expect(mockEphemeralFollowUp).toHaveBeenCalledTimes(1);
        expect(mockEphemeralFollowUp.mock.calls[0][1]).toBe(
          "Cannot claim: application is already **approved**."
        );
        // Terminal-state branch refreshes the card to reflect current state.
        expect(mockEnsureReviewMessage).toHaveBeenCalledWith(expect.anything(), APP.id);
        expect(mockLogActionPretty).not.toHaveBeenCalled();
        expect(mockNotifyDashboard).not.toHaveBeenCalled();
      });

      it("maps INVALID_STATUS panic mode without parsing a status word or refreshing", async () => {
        mockClaimTx.mockImplementation(() => {
          throw new ClaimError("Panic mode is active. All review operations are suspended.", "INVALID_STATUS");
        });

        await handleClaimToggle(makeInteraction(), APP as never);

        expect(mockEphemeralFollowUp).toHaveBeenCalledTimes(1);
        expect(mockEphemeralFollowUp.mock.calls[0][1]).toBe(
          "Panic mode is active; review operations are suspended."
        );
        // Panic branch must NOT refresh the card.
        expect(mockEnsureReviewMessage).not.toHaveBeenCalled();
      });

      it("maps APP_NOT_FOUND to application not found", async () => {
        mockClaimTx.mockImplementation(() => {
          throw new ClaimError("Application not found", "APP_NOT_FOUND");
        });

        await handleClaimToggle(makeInteraction(), APP as never);

        expect(mockEphemeralFollowUp.mock.calls[0][1]).toBe("Application not found.");
        expect(mockEnsureReviewMessage).not.toHaveBeenCalled();
      });

      it("uses the generic fallback for an unknown ClaimError code", async () => {
        mockClaimTx.mockImplementation(() => {
          throw new ClaimError("weird", "SOMETHING_ELSE");
        });

        await handleClaimToggle(makeInteraction(), APP as never);

        expect(mockEphemeralFollowUp.mock.calls[0][1]).toBe("Failed to claim application");
      });

      it("returns a generic message for unexpected (non-ClaimError) errors", async () => {
        mockClaimTx.mockImplementation(() => {
          throw new Error("boom: db offline");
        });

        await handleClaimToggle(makeInteraction(), APP as never);

        expect(mockEphemeralFollowUp.mock.calls[0][1]).toBe(
          "An unexpected error occurred. Please try again."
        );
        expect(mockNotifyDashboard).not.toHaveBeenCalled();
      });
    });

    describe("permanent rejection check", () => {
      it("queries the application table for the permanently_rejected flag", async () => {
        await handleClaimToggle(makeInteraction(), APP as never);

        expect(mockPrepare).toHaveBeenCalledWith(
          expect.stringContaining("permanently_rejected = 1")
        );
        expect(mockGet).toHaveBeenCalledWith(APP.guild_id, APP.user_id);
      });

      it("blocks the claim and notifies the moderator when the user is permanently rejected", async () => {
        mockGet.mockReturnValue({ permanently_rejected: 1 });

        await handleClaimToggle(makeInteraction(), APP as never);

        expect(mockEphemeralFollowUp).toHaveBeenCalledTimes(1);
        expect(mockEphemeralFollowUp.mock.calls[0][1]).toContain("permanently rejected");
        // Blocked: must not log the claim, refresh, or notify the dashboard.
        expect(mockLogActionPretty).not.toHaveBeenCalled();
        expect(mockEnsureReviewMessage).not.toHaveBeenCalled();
        expect(mockNotifyDashboard).not.toHaveBeenCalled();
      });

      it("allows the claim when the user is not permanently rejected", async () => {
        mockGet.mockReturnValue(undefined);

        await handleClaimToggle(makeInteraction(), APP as never);

        expect(mockNotifyDashboard).toHaveBeenCalledWith("review:claimed", {
          appId: APP.id,
          reviewerId: "moderator-99",
        });
      });
    });

    describe("success flow", () => {
      it("logs the claim action via logActionPretty with the expected payload", async () => {
        await handleClaimToggle(makeInteraction(), APP as never);

        expect(mockLogActionPretty).toHaveBeenCalledTimes(1);
        const [, payload] = mockLogActionPretty.mock.calls[0];
        expect(payload).toMatchObject({
          appId: APP.id,
          actorId: "moderator-99",
          subjectId: APP.user_id,
          action: "claim",
        });
      });

      it("refreshes the review card after a successful claim", async () => {
        await handleClaimToggle(makeInteraction(), APP as never);

        expect(mockEnsureReviewMessage).toHaveBeenCalledWith(expect.anything(), APP.id);
      });

      it("notifies the dashboard and confirms privately to the clicking moderator", async () => {
        await handleClaimToggle(makeInteraction(), APP as never);

        expect(mockNotifyDashboard).toHaveBeenCalledWith("review:claimed", {
          appId: APP.id,
          reviewerId: "moderator-99",
        });
        expect(mockEphemeralFollowUp).toHaveBeenLastCalledWith(
          expect.anything(),
          "You have claimed this application."
        );
      });

      it("caches the moderator identity for dashboard display", async () => {
        await handleClaimToggle(makeInteraction(), APP as never);

        expect(mockCacheUser).toHaveBeenCalledTimes(1);
      });

      it("still confirms even when card refresh throws", async () => {
        mockEnsureReviewMessage.mockRejectedValue(new Error("discord 500"));

        await handleClaimToggle(makeInteraction(), APP as never);

        // Refresh failure is swallowed; the mod still gets confirmation and the
        // dashboard is still notified.
        expect(mockNotifyDashboard).toHaveBeenCalledTimes(1);
        expect(mockEphemeralFollowUp).toHaveBeenLastCalledWith(
          expect.anything(),
          "You have claimed this application."
        );
      });
    });

    describe("deferUpdate behavior", () => {
      it("does not call deferUpdate (parent already deferred)", async () => {
        const deferUpdate = vi.fn();
        await handleClaimToggle(makeInteraction({ deferUpdate }), APP as never);

        expect(deferUpdate).not.toHaveBeenCalled();
      });
    });
  });

  describe("handleUnclaimAction", () => {
    describe("ClaimError handling", () => {
      it("maps NOT_CLAIMED to a not-currently-claimed message", async () => {
        mockUnclaimTx.mockImplementation(() => {
          throw new ClaimError("not claimed", "NOT_CLAIMED");
        });

        await handleUnclaimAction(makeInteraction(), APP as never);

        expect(mockEphemeralFollowUp.mock.calls[0][1]).toBe(
          "This application is not currently claimed."
        );
        expect(mockNotifyDashboard).not.toHaveBeenCalled();
      });

      it("maps NOT_OWNER to an ownership message", async () => {
        mockUnclaimTx.mockImplementation(() => {
          throw new ClaimError("not owner", "NOT_OWNER");
        });

        await handleUnclaimAction(makeInteraction(), APP as never);

        expect(mockEphemeralFollowUp.mock.calls[0][1]).toBe(
          "You did not claim this application. Only the claim owner can unclaim it."
        );
      });

      it("maps APP_NOT_FOUND to application not found", async () => {
        mockUnclaimTx.mockImplementation(() => {
          throw new ClaimError("nope", "APP_NOT_FOUND");
        });

        await handleUnclaimAction(makeInteraction(), APP as never);

        expect(mockEphemeralFollowUp.mock.calls[0][1]).toBe("Application not found.");
      });

      it("uses the generic fallback for an unknown unclaim ClaimError code", async () => {
        mockUnclaimTx.mockImplementation(() => {
          throw new ClaimError("weird", "SOMETHING_ELSE");
        });

        await handleUnclaimAction(makeInteraction(), APP as never);

        expect(mockEphemeralFollowUp.mock.calls[0][1]).toBe("Failed to unclaim application");
      });

      it("returns a generic message for unexpected (non-ClaimError) errors", async () => {
        mockUnclaimTx.mockImplementation(() => {
          throw new Error("boom");
        });

        await handleUnclaimAction(makeInteraction(), APP as never);

        expect(mockEphemeralFollowUp.mock.calls[0][1]).toBe(
          "An unexpected error occurred. Please try again."
        );
      });
    });

    describe("success flow", () => {
      it("logs the unclaim action via logActionPretty with unclaim meta", async () => {
        await handleUnclaimAction(makeInteraction(), APP as never);

        expect(mockLogActionPretty).toHaveBeenCalledTimes(1);
        const [, payload] = mockLogActionPretty.mock.calls[0];
        expect(payload).toMatchObject({
          appId: APP.id,
          action: "unclaim",
          meta: { type: "unclaim" },
        });
      });

      it("refreshes the review card after a successful unclaim", async () => {
        await handleUnclaimAction(makeInteraction(), APP as never);

        expect(mockEnsureReviewMessage).toHaveBeenCalledWith(expect.anything(), APP.id);
      });

      it("notifies the dashboard and sends an ephemeral confirmation with the short code", async () => {
        await handleUnclaimAction(makeInteraction(), APP as never);

        expect(mockNotifyDashboard).toHaveBeenCalledWith("review:unclaimed", {
          appId: APP.id,
          reviewerId: "moderator-99",
        });
        // shortCode mock uppercases the last 6 chars of the id.
        expect(mockEphemeralFollowUp).toHaveBeenLastCalledWith(
          expect.anything(),
          "Application `ABC123` unclaimed successfully."
        );
      });
    });
  });
});
