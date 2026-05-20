// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/art.queue.reorder.test.ts
 * WHAT: Unit tests for /api/art/queue/reorder POST handler.
 * WHY: The validation uses `newPosition === undefined` rather than truthy
 *      check; pin that newPosition=0 is a VALID input (most natural way to
 *      reorder to the head). A switch to `!newPosition` would silently
 *      break the "move to first" UX, and only this test would catch it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { mockCallBotApi } = vi.hoisted(() => ({ mockCallBotApi: vi.fn() }));

vi.mock("$lib/server/botApi", () => ({ callBotApi: mockCallBotApi }));

const { POST } = await import(
  "../../../web/src/routes/api/art/queue/reorder/+server.js"
);

const smUser = { id: "u1", tier: "sm" } as const;
const validBody = { targetUserId: "t1", newPosition: 3 };

beforeEach(() => {
  mockCallBotApi.mockReset();
});

describe("POST /api/art/queue/reorder", () => {
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
      POST(makeEvent({ user: smUser, body: { newPosition: 1 } })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when newPosition missing", async () => {
    await expect(
      POST(makeEvent({ user: smUser, body: { targetUserId: "t1" } })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("200 happy path with newPosition=0 (moves to head)", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    const res = await POST(
      makeEvent({
        user: smUser,
        body: { targetUserId: "t1", newPosition: 0 },
      }),
    );
    expect(res.status).toBe(200);
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/art/queue/reorder", {
      userId: "u1",
      tier: "sm",
      targetUserId: "t1",
      newPosition: 0,
    });
  });

  it("200 happy path forwards both fields", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    await POST(makeEvent({ user: smUser, body: validBody }));
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/art/queue/reorder", {
      userId: "u1",
      tier: "sm",
      targetUserId: "t1",
      newPosition: 3,
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
