// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, vi } from "vitest";
import type { ChatInputCommandInteraction } from "discord.js";

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import * as errorCard from "../../src/lib/errorCard.js";

describe("safeReply", () => {
  it("replies when interaction has not responded", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      replied: false,
      deferred: false,
      reply,
      followUp: vi.fn(),
      editReply: vi.fn(),
    } as unknown as ChatInputCommandInteraction;

    await errorCard.safeReply(interaction, { content: "hi", ephemeral: true });
    expect(reply).toHaveBeenCalledWith({ content: "hi", ephemeral: true });
  });

  it("edits deferred reply", async () => {
    const editReply = vi.fn().mockResolvedValue(undefined);
    const followUp = vi.fn();
    const reply = vi.fn();
    const interaction = {
      replied: false,
      deferred: true,
      reply,
      followUp,
      editReply,
    } as unknown as ChatInputCommandInteraction;

    await errorCard.safeReply(interaction, { content: "done", ephemeral: true });
    expect(editReply).toHaveBeenCalledWith({ content: "done" });
    expect(followUp).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it("uses followUp when already replied", async () => {
    const followUp = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      replied: true,
      deferred: false,
      reply: vi.fn(),
      followUp,
      editReply: vi.fn(),
    } as unknown as ChatInputCommandInteraction;

    await errorCard.safeReply(interaction, { content: "later", ephemeral: true });
    expect(followUp).toHaveBeenCalledWith({ content: "later", ephemeral: true });
  });
});

describe("postErrorCard", () => {
  it("builds error embed with mapped hint", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      replied: false,
      deferred: false,
      reply,
      followUp: vi.fn(),
      editReply: vi.fn(),
    } as unknown as ChatInputCommandInteraction;

    await errorCard.postErrorCard(interaction, {
      traceId: "trace123",
      cmd: "gate factory-reset",
      phase: "drop_or_truncate",
      err: { name: "SqliteError", code: "SQLITE_ERROR", message: "no such table" },
    });

    expect(reply).toHaveBeenCalledTimes(1);
    const payload = reply.mock.calls[0][0];
    expect(payload).toMatchObject({ ephemeral: true });
    const embed = payload.embeds?.[0];
    expect(embed).toBeDefined();
    const json = embed?.toJSON();
    expect(json?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Command", value: "/gate factory-reset" }),
        expect.objectContaining({ name: "Phase", value: "drop_or_truncate" }),
        expect.objectContaining({ name: "Code", value: "SQLITE_ERROR" }),
        expect.objectContaining({
          name: "Hint",
          value: "Database schema mismatch. Run migrations or reset safely.",
        }),
        expect.objectContaining({ name: "Trace", value: "trace123" }),
      ])
    );
  });
});
