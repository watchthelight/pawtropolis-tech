// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatInputCommandInteraction } from "discord.js";

vi.mock("nanoid", () => ({
  nanoid: () => "trace-fixed",
}));

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../src/lib/logger.js", () => ({
  logger: loggerMock,
}));

const sentryMock = vi.hoisted(() => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  setContext: vi.fn(),
  setTag: vi.fn(),
}));

vi.mock("../../src/lib/sentry.js", () => sentryMock);

const postErrorCardMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../../src/lib/errorCard.js", () => ({
  postErrorCard: postErrorCardMock,
}));

import { wrapCommand, withStep } from "../../src/lib/cmdWrap.js";

function createInteraction(): ChatInputCommandInteraction {
  return {
    user: { id: "user-1", username: "tester" },
    guildId: "guild-1",
    deferred: false,
    replied: false,
    reply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChatInputCommandInteraction;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("wrapCommand", () => {
  it("logs start, step, and completion on success", async () => {
    const interaction = createInteraction();
    const handler = wrapCommand("statusupdate", async (ctx) => {
      await withStep(ctx, "validate_input", async () => undefined);
    });

    await handler(interaction);

    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.objectContaining({ evt: "cmd_start", traceId: "trace-fixed", cmd: "statusupdate" })
    );
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.objectContaining({ evt: "cmd_step", phase: "validate_input" })
    );
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.objectContaining({ evt: "cmd_ok", cmd: "statusupdate" })
    );
    expect(postErrorCardMock).not.toHaveBeenCalled();
  });

  it("records error and posts error card on failure", async () => {
    const interaction = createInteraction();
    const handler = wrapCommand("gate", async (ctx) => {
      ctx.step("db_begin");
      const err = new Error("boom");
      (err as { code?: string }).code = "SQLITE_ERROR";
      err.name = "SqliteError";
      throw err;
    });

    await expect(handler(interaction)).resolves.toBeUndefined();

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        evt: "cmd_error",
        cmd: "gate",
        phase: "db_begin",
        err: expect.objectContaining({ name: "SqliteError", code: "SQLITE_ERROR" }),
      })
    );
    expect(postErrorCardMock).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({
        traceId: "trace-fixed",
        cmd: "gate",
        phase: "db_begin",
      })
    );
    expect(sentryMock.captureException).toHaveBeenCalled();
  });
});
