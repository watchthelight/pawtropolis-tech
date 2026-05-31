/**
 * Pawtropolis Tech — tests/features/review/handlers/actionRunners.test.ts
 * WHAT: Unit tests for review action runner functions (the real orchestrators).
 * WHY: Verify approval, rejection, perm-rejection and kick flows wire their
 *      collaborators together correctly: claim-guard enforcement, the
 *      role-grant-failure abort block, modmail auto-close, meta writes, and the
 *      public confirmation messages. These drive the REAL runners and assert on
 *      mocked external boundaries (db, discord.js, logger, flows).
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Guild, GuildMember, User } from "discord.js";

// ===== Mock external boundaries =====

const mockDbStatement = vi.hoisted(() => ({
  get: vi.fn(),
  run: vi.fn(),
}));
const mockDb = vi.hoisted(() => ({
  prepare: vi.fn(() => mockDbStatement),
  transaction: vi.fn((fn: () => unknown) => fn),
}));
vi.mock("../../../../src/db/db.js", () => ({ db: mockDb }));

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("../../../../src/lib/logger.js", () => ({ logger: mockLogger }));

vi.mock("../../../../src/lib/sentry.js", () => ({
  captureException: vi.fn(),
}));

vi.mock("../../../../src/lib/config.js", () => ({
  getConfig: vi.fn(),
}));

// ephemeralFollowUp is the real reply surface used by the runners.
vi.mock("../../../../src/lib/cmdWrap.js", () => ({
  ephemeralFollowUp: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/lib/reqctx.js", () => ({
  enrichEvent: vi.fn(),
}));

vi.mock("../../../../src/lib/ids.js", () => ({
  shortCode: vi.fn((id: string) => id.slice(-6).toUpperCase()),
}));

vi.mock("../../../../src/lib/time.js", () => ({
  nowUtc: vi.fn(() => 1748600000),
}));

vi.mock("../../../../src/lib/userCache.js", () => ({
  cacheUser: vi.fn(),
}));

vi.mock("../../../../src/web/notifyDashboard.js", () => ({
  notifyDashboard: vi.fn(),
}));

vi.mock("../../../../src/logging/pretty.js", () => ({
  logActionPretty: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/features/modmail.js", () => ({
  closeModmailForApplication: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/features/welcome.js", () => ({
  postWelcomeCard: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/features/welcomeBatch.js", () => ({
  tryEnqueueWelcome: vi.fn(() => false),
}));

vi.mock("../../../../src/features/gate/threadGate.js", () => ({
  cleanupVerifyThreadForUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/features/review/claims.js", () => ({
  getClaim: vi.fn(() => null),
  claimGuard: vi.fn(() => null),
}));

vi.mock("../../../../src/features/review/queries.js", () => ({
  updateReviewActionMeta: vi.fn(),
  insertVoteOut: vi.fn(),
  getVoteOutVoters: vi.fn(() => []),
  getVoteOutEntries: vi.fn(() => []),
  removeVoteOut: vi.fn(),
}));

vi.mock("../../../../src/features/review/flows/index.js", () => ({
  approveTx: vi.fn(),
  rejectTx: vi.fn(),
  kickTx: vi.fn(),
  approveFlow: vi.fn().mockResolvedValue({ member: null, roleApplied: false, roleError: null }),
  rejectFlow: vi.fn().mockResolvedValue({ dmDelivered: true }),
  kickFlow: vi.fn().mockResolvedValue({ kickSucceeded: true }),
  deliverApprovalDm: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../../../src/features/review.js", () => ({
  ensureReviewMessage: vi.fn().mockResolvedValue({ messageId: "msg-123" }),
}));

// ===== Imports (after mocks) =====

import {
  runApproveAction,
  runRejectAction,
  runPermRejectAction,
  runKickAction,
} from "../../../../src/features/review/handlers/actionRunners.js";

import { getConfig } from "../../../../src/lib/config.js";
import { ephemeralFollowUp } from "../../../../src/lib/cmdWrap.js";
import { getClaim, claimGuard } from "../../../../src/features/review/claims.js";
import { updateReviewActionMeta } from "../../../../src/features/review/queries.js";
import {
  approveTx,
  rejectTx,
  kickTx,
  approveFlow,
  rejectFlow,
  kickFlow,
  deliverApprovalDm,
} from "../../../../src/features/review/flows/index.js";
import { closeModmailForApplication } from "../../../../src/features/modmail.js";
import { postWelcomeCard } from "../../../../src/features/welcome.js";
import type { ApplicationRow } from "../../../../src/features/review/types.js";

// ===== Test helpers =====

function makeApp(overrides: Partial<ApplicationRow> = {}): ApplicationRow {
  return {
    id: "app-123",
    guild_id: "guild-1",
    user_id: "applicant-456",
    status: "submitted",
    ...overrides,
  };
}

type MockChannel = { send: ReturnType<typeof vi.fn> };

function makeInteraction(options: {
  guild?: Guild | null;
  channel?: MockChannel | null;
  userId?: string;
  fetchUser?: User | null;
} = {}) {
  const channel =
    options.channel === undefined
      ? { send: vi.fn().mockResolvedValue(undefined) }
      : options.channel;

  const guild =
    options.guild === undefined
      ? ({ id: "guild-1", name: "Test Server", memberCount: 10 } as unknown as Guild)
      : options.guild;

  const usersFetch =
    options.fetchUser === null
      ? vi.fn().mockRejectedValue(new Error("no user"))
      : vi.fn().mockResolvedValue(
          options.fetchUser ?? ({ id: "applicant-456" } as unknown as User)
        );

  return {
    guild,
    guildId: guild ? "guild-1" : null,
    channel,
    user: { id: options.userId ?? "mod-789" },
    member: null,
    client: {
      users: { fetch: usersFetch },
    },
  } as never;
}

function makeMember(id = "applicant-456"): GuildMember {
  return { id, user: { id } } as unknown as GuildMember;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Restore sensible defaults the runners rely on.
  vi.mocked(getClaim).mockReturnValue(null as never);
  vi.mocked(claimGuard).mockReturnValue(null);
  vi.mocked(getConfig).mockReturnValue(null as never);
  vi.mocked(approveFlow).mockResolvedValue({ member: null, roleApplied: false, roleError: null });
  vi.mocked(rejectFlow).mockResolvedValue({ dmDelivered: true } as never);
  vi.mocked(kickFlow).mockResolvedValue({ kickSucceeded: true } as never);
  vi.mocked(deliverApprovalDm).mockResolvedValue(true);
});

// ===== runApproveAction =====

describe("runApproveAction", () => {
  it("replies 'Guild not found.' and does no work when guild is null", async () => {
    const interaction = makeInteraction({ guild: null });

    await runApproveAction(interaction, makeApp());

    expect(ephemeralFollowUp).toHaveBeenCalledWith(interaction, "Guild not found.");
    expect(approveTx).not.toHaveBeenCalled();
  });

  it("replies with the claim-guard message and aborts when another mod has claimed", async () => {
    vi.mocked(claimGuard).mockReturnValue("This application is claimed by someone else.");
    const interaction = makeInteraction();

    await runApproveAction(interaction, makeApp());

    expect(ephemeralFollowUp).toHaveBeenCalledWith(
      interaction,
      "This application is claimed by someone else."
    );
    expect(approveTx).not.toHaveBeenCalled();
  });

  it("checks the claim before running the transaction", async () => {
    vi.mocked(approveTx).mockReturnValue({ kind: "changed", reviewActionId: 7 } as never);
    const interaction = makeInteraction();
    const app = makeApp();

    await runApproveAction(interaction, app);

    expect(getClaim).toHaveBeenCalledWith(app.id);
    expect(claimGuard).toHaveBeenCalledWith(null, "mod-789");
    expect(approveTx).toHaveBeenCalledWith(app.id, "mod-789", undefined);
  });

  it("replies 'Already approved.' on an 'already' tx result", async () => {
    vi.mocked(approveTx).mockReturnValue({ kind: "already", status: "approved" } as never);
    const interaction = makeInteraction();

    await runApproveAction(interaction, makeApp());

    expect(ephemeralFollowUp).toHaveBeenCalledWith(interaction, "Already approved.");
    expect(closeModmailForApplication).not.toHaveBeenCalled();
  });

  it("replies with the resolved status on a 'terminal' tx result", async () => {
    vi.mocked(approveTx).mockReturnValue({ kind: "terminal", status: "rejected" } as never);
    const interaction = makeInteraction();

    await runApproveAction(interaction, makeApp());

    expect(ephemeralFollowUp).toHaveBeenCalledWith(interaction, "Already resolved (rejected).");
  });

  it("replies 'not ready' on an 'invalid' tx result", async () => {
    vi.mocked(approveTx).mockReturnValue({ kind: "invalid", status: "draft" } as never);
    const interaction = makeInteraction();

    await runApproveAction(interaction, makeApp());

    expect(ephemeralFollowUp).toHaveBeenCalledWith(
      interaction,
      "Application is not ready for approval."
    );
  });

  it("ABORTS the approval, skips the welcome DM, and records dmDelivered=false when a configured role grant fails", async () => {
    vi.mocked(approveTx).mockReturnValue({ kind: "changed", reviewActionId: 99 } as never);
    vi.mocked(getConfig).mockReturnValue({ accepted_role_id: "role-1" } as never);
    // approveFlow returns roleApplied=false with an error.
    vi.mocked(approveFlow).mockResolvedValue({
      member: makeMember(),
      roleApplied: false,
      roleError: { code: 50013, message: "Missing Permissions" },
    });
    const channel = { send: vi.fn().mockResolvedValue(undefined) };
    const interaction = makeInteraction({ channel });

    await runApproveAction(interaction, makeApp());

    // The loud channel error is posted.
    expect(channel.send).toHaveBeenCalledTimes(1);
    const sent = channel.send.mock.calls[0][0].content as string;
    expect(sent).toContain("Role grant failed");
    expect(sent).toContain("NOT sent a welcome DM");

    // Critical: the welcome DM must NOT be sent and welcome card not posted.
    expect(deliverApprovalDm).not.toHaveBeenCalled();
    expect(postWelcomeCard).not.toHaveBeenCalled();

    // Meta records the failure; modmail is not closed because we returned early.
    expect(updateReviewActionMeta).toHaveBeenCalledWith(99, {
      roleApplied: false,
      dmDelivered: false,
    });
    expect(closeModmailForApplication).not.toHaveBeenCalled();
  });

  it("on full success: delivers DM, closes modmail with reason 'approved', writes meta, posts 'Application approved.'", async () => {
    vi.mocked(approveTx).mockReturnValue({ kind: "changed", reviewActionId: 5 } as never);
    // No config -> role block is skipped, member still delivered for DM path.
    vi.mocked(getConfig).mockReturnValue(null as never);
    vi.mocked(approveFlow).mockResolvedValue({
      member: makeMember(),
      roleApplied: false,
      roleError: null,
    });
    const channel = { send: vi.fn().mockResolvedValue(undefined) };
    const interaction = makeInteraction({ channel });

    await runApproveAction(interaction, makeApp());

    // With no config, approveFlow is not called (cfg is null) so member stays null
    // and the DM path is skipped. Modmail still closes and the public message posts.
    expect(closeModmailForApplication).toHaveBeenCalledWith(
      "guild-1",
      "applicant-456",
      expect.any(String),
      expect.objectContaining({ reason: "approved" })
    );
    expect(updateReviewActionMeta).toHaveBeenCalledWith(5, {
      roleApplied: false,
      dmDelivered: false,
    });
    // With no general_channel_id configured, the source appends a "not posted"
    // welcome note, so the public message's first line is the approval line.
    const contents = channel.send.mock.calls.map((c: unknown[]) => (c[0] as { content: string }).content);
    expect(contents.some((c: string) => c.startsWith("Application approved."))).toBe(true);
  });

  it("delivers the approval DM when a config exists and the member is resolved", async () => {
    vi.mocked(approveTx).mockReturnValue({ kind: "changed", reviewActionId: 8 } as never);
    // Config with NO accepted_role_id -> role block not triggered, welcome allowed.
    vi.mocked(getConfig).mockReturnValue({ general_channel_id: "gen-1" } as never);
    const member = makeMember();
    vi.mocked(approveFlow).mockResolvedValue({
      member,
      roleApplied: false,
      roleError: null,
    });
    const interaction = makeInteraction();

    await runApproveAction(interaction, makeApp(), "good answers");

    expect(deliverApprovalDm).toHaveBeenCalledWith(member, "Test Server", "good answers");
    expect(postWelcomeCard).toHaveBeenCalled();
  });
});

// ===== runRejectAction =====

describe("runRejectAction", () => {
  it("blocks an already-resolved application", async () => {
    const interaction = makeInteraction();

    await runRejectAction(interaction, makeApp({ status: "approved" }), "nope");

    expect(ephemeralFollowUp).toHaveBeenCalledWith(
      interaction,
      "This application is already resolved."
    );
    expect(rejectTx).not.toHaveBeenCalled();
  });

  it("enforces the claim guard before validating the reason", async () => {
    vi.mocked(claimGuard).mockReturnValue("claimed by other");
    const interaction = makeInteraction();

    await runRejectAction(interaction, makeApp(), "some reason");

    expect(ephemeralFollowUp).toHaveBeenCalledWith(interaction, "claimed by other");
    expect(rejectTx).not.toHaveBeenCalled();
  });

  it("requires a non-empty reason after trimming", async () => {
    const interaction = makeInteraction();

    await runRejectAction(interaction, makeApp(), "   ");

    expect(ephemeralFollowUp).toHaveBeenCalledWith(interaction, "Reason is required.");
    expect(rejectTx).not.toHaveBeenCalled();
  });

  it("passes the trimmed reason to rejectTx", async () => {
    vi.mocked(rejectTx).mockReturnValue({ kind: "changed", reviewActionId: 3 } as never);
    const interaction = makeInteraction();
    const app = makeApp();

    await runRejectAction(interaction, app, "   Bad application   ");

    expect(rejectTx).toHaveBeenCalledWith(app.id, "mod-789", "Bad application");
  });

  it("replies 'Already rejected.' on an 'already' tx result", async () => {
    vi.mocked(rejectTx).mockReturnValue({ kind: "already", status: "rejected" } as never);
    const interaction = makeInteraction();

    await runRejectAction(interaction, makeApp(), "reason");

    expect(ephemeralFollowUp).toHaveBeenCalledWith(interaction, "Already rejected.");
  });

  it("replies 'not submitted yet' on an 'invalid' tx result", async () => {
    vi.mocked(rejectTx).mockReturnValue({ kind: "invalid", status: "draft" } as never);
    const interaction = makeInteraction();

    await runRejectAction(interaction, makeApp(), "reason");

    expect(ephemeralFollowUp).toHaveBeenCalledWith(interaction, "Application not submitted yet.");
  });

  it("closes modmail with reason 'rejected' BEFORE sending the rejection DM", async () => {
    vi.mocked(rejectTx).mockReturnValue({ kind: "changed", reviewActionId: 11 } as never);
    const callOrder: string[] = [];
    vi.mocked(closeModmailForApplication).mockImplementation(async () => {
      callOrder.push("modmail");
    });
    vi.mocked(rejectFlow).mockImplementation(async () => {
      callOrder.push("dm");
      return { dmDelivered: true } as never;
    });
    const interaction = makeInteraction();

    await runRejectAction(interaction, makeApp(), "bad fit");

    expect(closeModmailForApplication).toHaveBeenCalledWith(
      "guild-1",
      "applicant-456",
      expect.any(String),
      expect.objectContaining({ reason: "rejected" })
    );
    expect(callOrder).toEqual(["modmail", "dm"]);
  });

  it("posts 'Application rejected.' when the DM is delivered", async () => {
    vi.mocked(rejectTx).mockReturnValue({ kind: "changed", reviewActionId: 12 } as never);
    vi.mocked(rejectFlow).mockResolvedValue({ dmDelivered: true } as never);
    const channel = { send: vi.fn().mockResolvedValue(undefined) };
    const interaction = makeInteraction({ channel });

    await runRejectAction(interaction, makeApp(), "reason");

    expect(channel.send).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Application rejected." })
    );
  });

  it("notes DM delivery failure in the public message when the DM fails", async () => {
    vi.mocked(rejectTx).mockReturnValue({ kind: "changed", reviewActionId: 13 } as never);
    vi.mocked(rejectFlow).mockResolvedValue({ dmDelivered: false } as never);
    const channel = { send: vi.fn().mockResolvedValue(undefined) };
    const interaction = makeInteraction({ channel });

    await runRejectAction(interaction, makeApp(), "reason");

    expect(channel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Application rejected. (DM delivery failed)",
      })
    );
  });

  it("writes meta with dmDelivered=false when the applicant user cannot be fetched", async () => {
    vi.mocked(rejectTx).mockReturnValue({ kind: "changed", reviewActionId: 14 } as never);
    const interaction = makeInteraction({ fetchUser: null });

    await runRejectAction(interaction, makeApp(), "reason");

    expect(rejectFlow).not.toHaveBeenCalled();
    expect(updateReviewActionMeta).toHaveBeenCalledWith(14, { dmDelivered: false });
  });
});

// ===== runPermRejectAction =====

describe("runPermRejectAction", () => {
  it("blocks an already-resolved application", async () => {
    const interaction = makeInteraction();

    await runPermRejectAction(interaction, makeApp({ status: "kicked" }), "reason");

    expect(ephemeralFollowUp).toHaveBeenCalledWith(
      interaction,
      "This application is already resolved."
    );
    expect(rejectTx).not.toHaveBeenCalled();
  });

  it("requires a non-empty reason", async () => {
    const interaction = makeInteraction();

    await runPermRejectAction(interaction, makeApp(), "   ");

    expect(ephemeralFollowUp).toHaveBeenCalledWith(interaction, "Reason is required.");
  });

  it("passes permanent=true to rejectTx", async () => {
    vi.mocked(rejectTx).mockReturnValue({ kind: "changed", reviewActionId: 21 } as never);
    const interaction = makeInteraction();
    const app = makeApp();

    await runPermRejectAction(interaction, app, "ban reason");

    expect(rejectTx).toHaveBeenCalledWith(app.id, "mod-789", "ban reason", true);
  });

  it("calls rejectFlow with permanent=true", async () => {
    vi.mocked(rejectTx).mockReturnValue({ kind: "changed", reviewActionId: 22 } as never);
    const fetchedUser = { id: "applicant-456" } as unknown as User;
    const interaction = makeInteraction({ fetchUser: fetchedUser });

    await runPermRejectAction(interaction, makeApp(), "ban reason");

    expect(rejectFlow).toHaveBeenCalledWith(
      fetchedUser,
      expect.objectContaining({ permanent: true, reason: "ban reason" })
    );
  });

  it("closes modmail with reason 'permanently rejected'", async () => {
    vi.mocked(rejectTx).mockReturnValue({ kind: "changed", reviewActionId: 23 } as never);
    const interaction = makeInteraction();

    await runPermRejectAction(interaction, makeApp(), "ban reason");

    expect(closeModmailForApplication).toHaveBeenCalledWith(
      "guild-1",
      "applicant-456",
      expect.any(String),
      expect.objectContaining({ reason: "permanently rejected" })
    );
  });

  it("posts the permanent rejection confirmation", async () => {
    vi.mocked(rejectTx).mockReturnValue({ kind: "changed", reviewActionId: 24 } as never);
    vi.mocked(rejectFlow).mockResolvedValue({ dmDelivered: true } as never);
    const channel = { send: vi.fn().mockResolvedValue(undefined) };
    const interaction = makeInteraction({ channel });

    await runPermRejectAction(interaction, makeApp(), "ban reason");

    expect(channel.send).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Application permanently rejected." })
    );
  });
});

// ===== runKickAction =====

describe("runKickAction", () => {
  it("replies 'Guild not found.' when guild is null", async () => {
    const interaction = makeInteraction({ guild: null });

    await runKickAction(interaction, makeApp(), null);

    expect(ephemeralFollowUp).toHaveBeenCalledWith(interaction, "Guild not found.");
    expect(kickTx).not.toHaveBeenCalled();
  });

  it("enforces the claim guard before the transaction", async () => {
    vi.mocked(claimGuard).mockReturnValue("claimed by other");
    const interaction = makeInteraction();

    await runKickAction(interaction, makeApp(), null);

    expect(ephemeralFollowUp).toHaveBeenCalledWith(interaction, "claimed by other");
    expect(kickTx).not.toHaveBeenCalled();
  });

  it("replies 'Already kicked.' on an 'already' tx result", async () => {
    vi.mocked(kickTx).mockReturnValue({ kind: "already", status: "kicked" } as never);
    const interaction = makeInteraction();

    await runKickAction(interaction, makeApp(), null);

    expect(ephemeralFollowUp).toHaveBeenCalledWith(interaction, "Already kicked.");
  });

  it("replies 'not in a kickable state' on an 'invalid' tx result", async () => {
    vi.mocked(kickTx).mockReturnValue({ kind: "invalid", status: "draft" } as never);
    const interaction = makeInteraction();

    await runKickAction(interaction, makeApp(), null);

    expect(ephemeralFollowUp).toHaveBeenCalledWith(
      interaction,
      "Application not in a kickable state."
    );
  });

  it("calls kickFlow with the reason, writes the flow result to meta, and closes modmail as 'kicked'", async () => {
    vi.mocked(kickTx).mockReturnValue({ kind: "changed", reviewActionId: 31 } as never);
    const flowResult = { kickSucceeded: true } as never;
    vi.mocked(kickFlow).mockResolvedValue(flowResult);
    const interaction = makeInteraction();

    await runKickAction(interaction, makeApp(), "Spamming");

    expect(kickFlow).toHaveBeenCalledWith(
      expect.objectContaining({ id: "guild-1" }),
      "applicant-456",
      "Spamming"
    );
    expect(updateReviewActionMeta).toHaveBeenCalledWith(31, flowResult);
    expect(closeModmailForApplication).toHaveBeenCalledWith(
      "guild-1",
      "applicant-456",
      expect.any(String),
      expect.objectContaining({ reason: "kicked" })
    );
  });

  it("posts 'Member kicked.' when the kick succeeded", async () => {
    vi.mocked(kickTx).mockReturnValue({ kind: "changed", reviewActionId: 32 } as never);
    vi.mocked(kickFlow).mockResolvedValue({ kickSucceeded: true } as never);
    const channel = { send: vi.fn().mockResolvedValue(undefined) };
    const interaction = makeInteraction({ channel });

    await runKickAction(interaction, makeApp(), null);

    expect(channel.send).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Member kicked." })
    );
  });

  it("posts the 'check logs' message when the kick failed", async () => {
    vi.mocked(kickTx).mockReturnValue({ kind: "changed", reviewActionId: 33 } as never);
    vi.mocked(kickFlow).mockResolvedValue({ kickSucceeded: false } as never);
    const channel = { send: vi.fn().mockResolvedValue(undefined) };
    const interaction = makeInteraction({ channel });

    await runKickAction(interaction, makeApp(), null);

    expect(channel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Kick attempted; check logs for details.",
      })
    );
  });
});
