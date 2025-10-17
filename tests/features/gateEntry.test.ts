// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Collection, PermissionsBitField } from "discord.js";
import { ensurePinnedGateMessage } from "../../src/features/gate/gateEntry.js";

vi.mock("../../src/lib/config.js", () => ({
  getConfig: vi.fn(() => ({ gate_channel_id: "123" })),
}));

const warnMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    warn: warnMock,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../src/lib/sentry.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/sentry.js")>(
    "../../src/lib/sentry.js"
  );
  return {
    ...actual,
    addBreadcrumb: vi.fn(),
    captureException: vi.fn(),
  };
});

describe("ensurePinnedGateMessage", () => {
  beforeEach(() => {
    warnMock.mockClear();
  });

  it("creates message without pin when ManageMessages is missing", async () => {
    const pinMock = vi.fn();
    const editMock = vi.fn().mockResolvedValue(undefined);
    const sendMock = vi.fn().mockResolvedValue({
      author: { id: "bot" },
      embeds: [],
      pinned: false,
      pin: pinMock,
      edit: editMock,
    });
    const fetchPinnedMock = vi.fn().mockResolvedValue(new Collection());
    const channel = {
      id: "123",
      isTextBased: () => true,
      isDMBased: () => false,
      messages: {
        fetchPinned: fetchPinnedMock,
      },
      send: sendMock,
      guild: {
        members: {
          me: {
            permissionsIn: () =>
              new PermissionsBitField([
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
              ]),
          },
        },
      },
    };
    const client = {
      user: { id: "bot" },
      channels: {
        fetch: vi.fn().mockResolvedValue(channel),
      },
    } as unknown as Parameters<typeof ensurePinnedGateMessage>[0];

    const result = await ensurePinnedGateMessage(client, "guild-1");
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(pinMock).not.toHaveBeenCalled();
    expect(result.pinned).toBe(false);
    expect(result.reason).toContain("ManageMessages");
    expect(warnMock).toHaveBeenCalled();
  });
});
