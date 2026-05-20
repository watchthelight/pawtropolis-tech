// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/art.queue.add.test.ts
 * WHAT: Unit tests for /api/art/queue/add POST handler.
 * WHY: Adds a user to the art queue. Tier gate is `sm` (senior mod). The
 *      handler returns 409 only when the bot error contains "already" -- if
 *      the bot ever changes the string, the dashboard silently swaps it for
 *      a 400 and the UI's dedup logic breaks. Lock the substring contract.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { mockCallBotApi } = vi.hoisted(() => ({
  mockCallBotApi: vi.fn(),
}));

vi.mock("$lib/server/botApi", () => ({
  callBotApi: mockCallBotApi,
}));

const { POST } = await import(
  "../../../web/src/routes/api/art/queue/add/+server.js"
);

const smUser = { id: "u1", tier: "sm" } as const;
const validBody = { targetUserId: "t1" };

beforeEach(() => {
  mockCallBotApi.mockReset();
});

describe("POST /api/art/queue/add", () => {
  it("401 when locals.user is absent", async () => {
    await expect(
      POST(makeEvent({ user: null, body: validBody })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("403 when tier below sm (mod cannot add)", async () => {
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

  it("200 happy path", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: true,
      data: { queued: true },
    });
    const res = await POST(makeEvent({ user: smUser, body: validBody }));
    expect(res.status).toBe(200);
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/art/queue/add", {
      userId: "u1",
      tier: "sm",
      targetUserId: "t1",
    });
  });

  it("409 when bot error includes 'already'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "user already in queue",
    });
    const res = await POST(makeEvent({ user: smUser, body: validBody }));
    expect(res.status).toBe(409);
  });

  it("400 fallback on generic error", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "rate limited",
    });
    const res = await POST(makeEvent({ user: smUser, body: validBody }));
    expect(res.status).toBe(400);
  });
});
