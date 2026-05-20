// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/art.queue.remove.test.ts
 * WHAT: Unit tests for /api/art/queue/remove POST handler.
 * WHY: Removes a user from the art queue. Tier gate is `sm`. Note the
 *      substring used for 404 is just "not" (very loose) -- this test
 *      pins that behavior so any future tightening is intentional.
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
  "../../../web/src/routes/api/art/queue/remove/+server.js"
);

const smUser = { id: "u1", tier: "sm" } as const;
const validBody = { targetUserId: "t1" };

beforeEach(() => {
  mockCallBotApi.mockReset();
});

describe("POST /api/art/queue/remove", () => {
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

  it("200 happy path", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: true,
      data: { removed: true },
    });
    const res = await POST(makeEvent({ user: smUser, body: validBody }));
    expect(res.status).toBe(200);
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/art/queue/remove", {
      userId: "u1",
      tier: "sm",
      targetUserId: "t1",
    });
  });

  it("404 when bot error contains 'not' (e.g. 'not in queue')", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "user not in queue",
    });
    const res = await POST(makeEvent({ user: smUser, body: validBody }));
    expect(res.status).toBe(404);
  });

  it("400 fallback when bot error has no 'not'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "validation error",
    });
    const res = await POST(makeEvent({ user: smUser, body: validBody }));
    expect(res.status).toBe(400);
  });
});
