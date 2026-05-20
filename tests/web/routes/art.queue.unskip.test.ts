// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/art.queue.unskip.test.ts
 * WHAT: Unit tests for /api/art/queue/unskip POST handler.
 * WHY: Reverses a prior skip. Tier `sm`, single required field; thin
 *      coverage suffices but pins the 404 substring match (just "not") so
 *      a tightening to "not in queue" would fail here.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { mockCallBotApi } = vi.hoisted(() => ({ mockCallBotApi: vi.fn() }));

vi.mock("$lib/server/botApi", () => ({ callBotApi: mockCallBotApi }));

const { POST } = await import(
  "../../../web/src/routes/api/art/queue/unskip/+server.js"
);

const smUser = { id: "u1", tier: "sm" } as const;
const validBody = { targetUserId: "t1" };

beforeEach(() => {
  mockCallBotApi.mockReset();
});

describe("POST /api/art/queue/unskip", () => {
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
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    const res = await POST(makeEvent({ user: smUser, body: validBody }));
    expect(res.status).toBe(200);
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/art/queue/unskip", {
      userId: "u1",
      tier: "sm",
      targetUserId: "t1",
    });
  });

  it("404 when bot error includes 'not'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "user not skipped",
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
