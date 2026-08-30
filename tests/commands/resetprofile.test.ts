/**
 * Pawtropolis Tech -- tests/commands/resetprofile.test.ts
 * WHAT: Gates on /resetprofile, the command that wipes one member's reward history.
 * WHY: It is aimed at a person by hand and cannot be undone, so the password and
 *      permission checks have to hold before anything is deleted.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { execute, data } from "../../src/commands/resetprofile.js";
import { createTestCommandContext } from "../utils/contextFactory.js";
import { createMockInteraction, createMockUser } from "../utils/discordMocks.js";
import { PermissionFlagsBits } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/lib/secureCompare.js", () => ({
  secureCompare: vi.fn((a: string, b: string) => a === b),
}));

vi.mock("../../src/lib/rateLimiter.js", () => ({
  checkCooldown: vi.fn(() => ({ allowed: true })),
  formatCooldown: vi.fn((ms: number) => `${Math.round(ms / 1000)}s`),
  COOLDOWNS: { PASSWORD_FAIL_MS: 30000 },
}));

vi.mock("../../src/logging/pretty.js", () => ({
  logActionPretty: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/features/rewardReset.js", () => ({
  resetMemberRewardState: vi.fn(() => ({
    levelRewards: 2,
    items: 1,
    log: 3,
    grantKeys: 1,
    pendingCaptures: 0,
  })),
  totalRowsCleared: vi.fn(() => 7),
}));

const originalEnv = process.env;
const TARGET = createMockUser({ id: "target-user" });

function buildInteraction(password: string, hasManageGuild = true): ChatInputCommandInteraction {
  return createMockInteraction({
    options: {
      getString: { password },
      getUser: { user: TARGET },
    },
    member: {
      permissions: { has: vi.fn().mockReturnValue(hasManageGuild) },
      roles: { cache: new Map() },
    },
  } as never);
}

describe("/resetprofile", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, RESET_PASSWORD: "test-password", ADMIN_ROLE_ID: "" };

    const { secureCompare } = await import("../../src/lib/secureCompare.js");
    (secureCompare as never as { mockImplementation: (f: unknown) => void }).mockImplementation(
      (a: string, b: string) => a === b
    );

    const { checkCooldown, formatCooldown } = await import("../../src/lib/rateLimiter.js");
    (checkCooldown as never as { mockReturnValue: (v: unknown) => void }).mockReturnValue({ allowed: true });
    (formatCooldown as never as { mockImplementation: (f: unknown) => void }).mockImplementation(
      (ms: number) => `${Math.round(ms / 1000)}s`
    );
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("registers a user option and a password option", () => {
    expect(data.name).toBe("resetprofile");
    const names = data.options.map((o) => o.toJSON().name);
    expect(names).toContain("user");
    expect(names).toContain("password");
    expect(data.toJSON().default_member_permissions).toBe(String(PermissionFlagsBits.ManageGuild));
  });

  it("REGRESSION: does not touch the database on a wrong password", async () => {
    const { resetMemberRewardState } = await import("../../src/features/rewardReset.js");
    const interaction = buildInteraction("wrong-password");

    await execute(createTestCommandContext(interaction));

    expect(resetMemberRewardState).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "❌ Incorrect password. Reset denied.",
    });
  });

  it("REGRESSION: does not touch the database without ManageGuild", async () => {
    const { resetMemberRewardState } = await import("../../src/features/rewardReset.js");
    const interaction = buildInteraction("test-password", false);

    await execute(createTestCommandContext(interaction));

    expect(resetMemberRewardState).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "❌ You don't have permission to reset a member's rewards.",
    });
  });

  it("refuses while the brute-force cooldown is active", async () => {
    const { checkCooldown } = await import("../../src/lib/rateLimiter.js");
    (checkCooldown as never as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      allowed: false,
      remainingMs: 30000,
    });
    const { resetMemberRewardState } = await import("../../src/features/rewardReset.js");
    const interaction = buildInteraction("test-password");

    await execute(createTestCommandContext(interaction));

    expect(resetMemberRewardState).not.toHaveBeenCalled();
  });

  it("clears the target and reports the counts", async () => {
    const { resetMemberRewardState } = await import("../../src/features/rewardReset.js");
    const interaction = buildInteraction("test-password");

    await execute(createTestCommandContext(interaction));

    expect(resetMemberRewardState).toHaveBeenCalledWith(interaction.guildId, "target-user");
    const reply = (interaction.editReply as never as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0] as {
      embeds?: Array<{ data: { title?: string } }>;
    };
    expect(reply.embeds?.[0]?.data.title).toBe("✅ Reward History Cleared");
  });
});
