/**
 * Pawtropolis Tech -- tests/commands/redeem.test.ts
 * WHAT: The spend-then-issue path in /redeem, and the two ways it used to lose an item.
 * WHY: The debit happens before the role write. Any outcome where the role does not
 *      actually land has to refund, or the member pays for nothing.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach, vi } from "vitest";
import { execute } from "../../src/commands/redeem.js";
import { createTestCommandContext } from "../utils/contextFactory.js";
import { createMockInteraction } from "../utils/discordMocks.js";
import type { ChatInputCommandInteraction } from "discord.js";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/features/panicStore.js", () => ({ isPanicMode: vi.fn(() => false) }));

vi.mock("../../src/features/inventory/catalog.js", () => ({
  inventoryEnabled: vi.fn(() => true),
  getItemByKey: vi.fn(() => ({
    itemKey: "byte:rare",
    roleId: "role-rare",
    display: "Byte Token [Rare]",
    source: "byte",
    policy: "every_grant",
  })),
}));

vi.mock("../../src/features/inventory/capture.js", () => ({
  suppressNextCapture: vi.fn(),
  clearSuppression: vi.fn(),
}));

vi.mock("../../src/features/inventory/store.js", () => ({
  debitItem: vi.fn(() => true),
  creditItem: vi.fn(() => 1),
  getInventory: vi.fn(() => []),
}));

vi.mock("../../src/features/roleAutomation.js", () => ({
  assignRole: vi.fn(),
}));

function buildInteraction(memberFetch: unknown): ChatInputCommandInteraction {
  const interaction = createMockInteraction({
    options: { getString: { item: "byte:rare" } },
  });
  const guild = interaction.guild as unknown as {
    roles: { cache: Map<string, unknown> };
    members: { fetch: unknown };
    client: { user: { id: string } };
  };
  guild.roles.cache = new Map([["role-rare", { id: "role-rare", name: "Byte Token [Rare]" }]]);
  guild.members.fetch = memberFetch;
  guild.client = { user: { id: "bot-self" } };
  return interaction;
}

const heldNothing = () => Promise.resolve({ roles: { cache: new Map() } });

describe("/redeem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("REGRESSION: refunds when the role add turns out to be a no-op", async () => {
    const { assignRole } = await import("../../src/features/roleAutomation.js");
    const { creditItem, debitItem } = await import("../../src/features/inventory/store.js");
    (assignRole as never as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      success: true,
      roleId: "role-rare",
      roleName: "Byte Token [Rare]",
      action: "skipped",
      reason: "User already has role",
    });

    const interaction = buildInteraction(heldNothing);
    await execute(createTestCommandContext(interaction));

    expect(debitItem).toHaveBeenCalled();
    expect(creditItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "byte:rare",
      1,
      "byte",
      expect.anything(),
      "refund: role could not be issued"
    );
  });

  it("REGRESSION: never debits when the member cannot be read", async () => {
    const { debitItem } = await import("../../src/features/inventory/store.js");
    const interaction = buildInteraction(() => Promise.reject(new Error("network")));

    await execute(createTestCommandContext(interaction));

    expect(debitItem).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: "Could not read your roles just now. Try again in a moment.",
      flags: 64,
    });
  });

  it("refuses without debiting when the member already wears the role", async () => {
    const { debitItem } = await import("../../src/features/inventory/store.js");
    const interaction = buildInteraction(() =>
      Promise.resolve({ roles: { cache: new Map([["role-rare", {}]]) } })
    );

    await execute(createTestCommandContext(interaction));

    expect(debitItem).not.toHaveBeenCalled();
  });

  it("keeps the item spent when the role really lands", async () => {
    const { assignRole } = await import("../../src/features/roleAutomation.js");
    const { creditItem } = await import("../../src/features/inventory/store.js");
    (assignRole as never as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      success: true,
      roleId: "role-rare",
      roleName: "Byte Token [Rare]",
      action: "add",
    });

    const interaction = buildInteraction(heldNothing);
    await execute(createTestCommandContext(interaction));

    expect(creditItem).not.toHaveBeenCalled();
  });

  it("refunds when the role write fails outright", async () => {
    const { assignRole } = await import("../../src/features/roleAutomation.js");
    const { creditItem } = await import("../../src/features/inventory/store.js");
    (assignRole as never as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      success: false,
      roleId: "role-rare",
      roleName: "Byte Token [Rare]",
      action: "skipped",
      error: "Missing Permissions",
    });

    const interaction = buildInteraction(heldNothing);
    await execute(createTestCommandContext(interaction));

    expect(creditItem).toHaveBeenCalled();
  });
});
