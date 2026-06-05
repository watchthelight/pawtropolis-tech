/**
 * Pawtropolis Tech — tests/commands/redeemreward.test.ts
 * WHAT: Permission-gate tests for /redeemreward.
 * WHY: Gate is staff (Junior Mod+) OR Ambassador OR ManageRoles. Junior Mods must
 *      be able to run it (decision by Community Manager, 2026-06-05).
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, vi } from "vitest";
import { execute } from "../../src/commands/redeemreward.js";
import { ROLE_IDS } from "../../src/lib/roles.js";
import { createTestCommandContext } from "../utils/contextFactory.js";
import { createMockInteraction, createMockUser, createMockMember, createMockGuild } from "../utils/discordMocks.js";
import type { Guild } from "discord.js";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const AMBASSADOR_ROLE_ID = "ambassador-role-id";

vi.mock("../../src/features/artistRotation/index.js", () => ({
  getAmbassadorRoleId: vi.fn(() => AMBASSADOR_ROLE_ID),
  getArtistRoleId: vi.fn(() => "artist-role-id"),
  getTicketRoles: vi.fn(() => ({})),
  getNextArtist: vi.fn(() => null),
  getArtist: vi.fn(() => null),
  TICKET_ROLE_NAMES: {},
  ART_TYPE_DISPLAY: { headshot: "Headshot", halfbody: "Half-body", emoji: "Emoji", fullbody: "Full-body" },
}));

function buildInteraction(roleIds: string[], hasManageRoles = false) {
  const targetUser = createMockUser({ id: "target-1", username: "target" });
  const member = createMockMember({ user: createMockUser({ id: "caller-1" }) });
  for (const id of roleIds) (member.roles.cache as Map<string, unknown>).set(id, {} as never);

  const guild = createMockGuild({ id: "guild-1" });
  // Default: target user not in guild, so the gate is the only thing under test.
  (guild.members.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Unknown Member"));

  const interaction = createMockInteraction({
    guild: guild as Guild,
    guildId: "guild-1",
    member: member as never,
    memberPermissions: { has: vi.fn().mockReturnValue(hasManageRoles) } as never,
    options: {
      getUser: { user: targetUser, artist: null },
      getString: { type: "headshot" },
    },
  });
  return interaction;
}

const DENIAL = "You need a staff role (Junior Moderator and above), the Ambassador role, or Manage Roles permission to use this command.";

describe("/redeemreward permission gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("denies a member with no staff role, no Ambassador role, no ManageRoles", async () => {
    const interaction = buildInteraction([]);
    await execute(createTestCommandContext(interaction));
    expect(interaction.reply).toHaveBeenCalledWith({ content: DENIAL, flags: 64 });
  });

  it("allows a Junior Moderator", async () => {
    const interaction = buildInteraction([ROLE_IDS.JUNIOR_MOD]);
    await execute(createTestCommandContext(interaction));
    expect(interaction.reply).not.toHaveBeenCalledWith({ content: DENIAL, flags: 64 });
  });

  it("allows a higher-ranked staff role (Moderator)", async () => {
    const interaction = buildInteraction([ROLE_IDS.MODERATOR]);
    await execute(createTestCommandContext(interaction));
    expect(interaction.reply).not.toHaveBeenCalledWith({ content: DENIAL, flags: 64 });
  });

  it("allows the Ambassador role with no hierarchy role", async () => {
    const interaction = buildInteraction([AMBASSADOR_ROLE_ID]);
    await execute(createTestCommandContext(interaction));
    expect(interaction.reply).not.toHaveBeenCalledWith({ content: DENIAL, flags: 64 });
  });

  it("allows ManageRoles with no staff or Ambassador role", async () => {
    const interaction = buildInteraction([], true);
    await execute(createTestCommandContext(interaction));
    expect(interaction.reply).not.toHaveBeenCalledWith({ content: DENIAL, flags: 64 });
  });
});
