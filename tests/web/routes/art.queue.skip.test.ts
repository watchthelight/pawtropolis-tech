// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/art.queue.skip.test.ts
 * WHAT: Unit tests for /api/art/queue/skip POST handler.
 * WHY: Moves an artist to the end of the queue (effectively a soft skip);
 *      optional `reason` should flow through to the bot for audit logging.
 *      Pin the pass-through so a future "always-required" tightening would
 *      fail loudly.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { mockCallBotApi } = vi.hoisted(() => ({ mockCallBotApi: vi.fn() }));

vi.mock("$lib/server/botApi", () => ({ callBotApi: mockCallBotApi }));

const { POST } = await import(
  "../../../web/src/routes/api/art/queue/skip/+server.js"
);

const smUser = { id: "u1", tier: "sm" } as const;
const validBody = { targetUserId: "t1" };

beforeEach(() => {
  mockCallBotApi.mockReset();
});

describe("POST /api/art/queue/skip", () => {
  it("401 when locals.user is absent", async () => {
    await expect(
      POST(makeEvent({ user: null, body: validBody })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("403 when tier below sm", async () => {
    await expect(
      POST(makeEvent({ user: { id: "u1", tier: "mod" }, body: validBody })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("400 on invalid JSON", async () => {
    await expect(
      POST(makeEvent({ user: smUser, rawBody: "x" })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when targetUserId missing", async () => {
    await expect(
      POST(makeEvent({ user: smUser, body: {} })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("200 happy path forwards reason when supplied", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    await POST(
      makeEvent({
        user: smUser,
        body: { targetUserId: "t1", reason: "afk" },
      }),
    );
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/art/queue/skip", {
      userId: "u1",
      tier: "sm",
      targetUserId: "t1",
      reason: "afk",
    });
  });

  it("200 happy path with reason omitted passes undefined", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    await POST(makeEvent({ user: smUser, body: validBody }));
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/art/queue/skip", {
      userId: "u1",
      tier: "sm",
      targetUserId: "t1",
      reason: undefined,
    });
  });

  it("404 when bot error includes 'not'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "user not in queue",
    });
    const res = await POST(makeEvent({ user: smUser, body: validBody }));
    expect(res.status).toBe(404);
  });

  it("400 fallback on generic bot error", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "validation failed",
    });
    const res = await POST(makeEvent({ user: smUser, body: validBody }));
    expect(res.status).toBe(400);
  });
});
