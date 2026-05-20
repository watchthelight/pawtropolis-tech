// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/users.resolve.test.ts
 * WHAT: Unit tests for /api/users/resolve POST handler.
 * WHY: The only batch endpoint in this slice -- body must contain a
 *      non-empty targetUserIds array. The empty-array path is an easy
 *      validation bug (truthy [] silently passes through to the bot,
 *      wasting a call). Lock it.
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
  "../../../web/src/routes/api/users/resolve/+server.js"
);

const gkUser = { id: "u1", tier: "gk" } as const;
const validBody = { targetUserIds: ["a", "b"] };

beforeEach(() => {
  mockCallBotApi.mockReset();
});

describe("POST /api/users/resolve", () => {
  it("401 when locals.user is absent", async () => {
    await expect(
      POST(makeEvent({ user: null, body: validBody })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("403 when tier below gk", async () => {
    await expect(
      POST(makeEvent({ user: { id: "u1", tier: "viewer" }, body: validBody })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("400 on invalid JSON", async () => {
    await expect(
      POST(makeEvent({ user: gkUser, rawBody: "x" })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when targetUserIds missing", async () => {
    await expect(
      POST(makeEvent({ user: gkUser, body: {} })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when targetUserIds is empty array", async () => {
    await expect(
      POST(makeEvent({ user: gkUser, body: { targetUserIds: [] } })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("200 happy path forwards array", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: true,
      data: { resolved: { a: "alice", b: "bob" } },
    });
    const res = await POST(makeEvent({ user: gkUser, body: validBody }));
    expect(res.status).toBe(200);
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/users/resolve", {
      userId: "u1",
      tier: "gk",
      targetUserIds: ["a", "b"],
    });
  });

  it("502 when bot error includes 'unreachable'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Bot API unreachable",
    });
    const res = await POST(makeEvent({ user: gkUser, body: validBody }));
    expect(res.status).toBe(502);
  });

  it("502 when bot error includes 'timed out'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Bot API request timed out",
    });
    const res = await POST(makeEvent({ user: gkUser, body: validBody }));
    expect(res.status).toBe(502);
  });

  it("400 fallback on generic bot error", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "rate limit exceeded",
    });
    const res = await POST(makeEvent({ user: gkUser, body: validBody }));
    expect(res.status).toBe(400);
  });
});
