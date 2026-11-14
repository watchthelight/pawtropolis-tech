// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/features/tickets/handlers.open.test.ts
 * WHAT: tk:open button handling.
 * WHY: A failed greeting send was reported as a failed open although the ticket existed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  create: vi.fn(),
  cooldown: vi.fn(),
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../../src/lib/rateLimiter.js", () => ({
  checkCooldown: h.cooldown,
  formatCooldown: () => "5s",
}));
vi.mock("../../../src/features/tickets/config.js", () => ({
  COMMUNITY_AMBASSADOR_ROLE_ID: "amb",
  MOD_TEAM_ROLE_ID: "mod",
}));
vi.mock("../../../src/features/tickets/registry.js", () => ({
  getTicketType: () => ({ key: "support", isActive: true }),
}));
vi.mock("../../../src/features/tickets/service.js", () => ({
  TicketService: { create: h.create },
}));

import { handleTicketButton } from "../../../src/features/tickets/handlers.js";

function makeInteraction() {
  return {
    customId: "tk:open:support",
    guild: { id: "g1" },
    user: { id: "u1" },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.cooldown.mockReturnValue({ allowed: true });
});

describe("tk:open", () => {
  it("reports partial success when the greeting failed", async () => {
    h.create.mockResolvedValue({
      ticket: { number: 3 },
      channel: { id: "chan1" },
      greetingFailed: true,
    });
    const interaction = makeInteraction();

    await handleTicketButton(interaction as never);

    const content = interaction.editReply.mock.calls[0]![0].content as string;
    expect(content).toContain("Ticket opened: <#chan1>");
    expect(content).toContain("welcome message could not be posted");
    expect(content).not.toContain("Failed to open");
  });

  it("reports a plain success otherwise", async () => {
    h.create.mockResolvedValue({ ticket: { number: 3 }, channel: { id: "chan1" } });
    const interaction = makeInteraction();

    await handleTicketButton(interaction as never);

    const content = interaction.editReply.mock.calls[0]![0].content as string;
    expect(content).toBe("Ticket opened: <#chan1> (`support-0003`)");
  });
});
