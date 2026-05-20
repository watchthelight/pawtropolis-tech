// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/review.action.test.ts
 * WHAT: Unit tests for /api/review/[action] POST handler.
 * WHY: The largest action surface in the dashboard (9 distinct actions),
 *      with a non-standard gate: `canPerformReviewAction` requires the
 *      actual Gatekeeper ROLE id, not just the tier. Higher tiers without
 *      the role can VIEW but not ACT. This route also bundles a UUID guard,
 *      a per-action `reason` requirement (kick / permreject / vote_out),
 *      and a 5-way status map. Locking it pays off any time the role gate
 *      logic shifts.
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
  "../../../web/src/routes/api/review/[action]/+server.js"
);

const GK_ROLE = "896070888762535969";
const validAppId = "01234567-89ab-cdef-0123-456789abcdef";
const validBody = { appId: validAppId };

const gkRoleUser = {
  id: "u1",
  tier: "mod" as const,
  roles: [GK_ROLE],
};
const adminNoRoleUser = {
  id: "u1",
  tier: "admin" as const,
  roles: [],
};
const viewerUser = { id: "u1", tier: "viewer" as const, roles: [] };

beforeEach(() => {
  mockCallBotApi.mockReset();
});

function evt(
  action: string,
  overrides: Partial<Parameters<typeof makeEvent>[0]> = {},
) {
  return makeEvent({
    user: gkRoleUser,
    params: { action },
    body: validBody,
    ...overrides,
  });
}

describe("POST /api/review/[action]", () => {
  it("404 unknown action (checked before auth)", async () => {
    await expect(POST(evt("yeet"))).rejects.toMatchObject({ status: 404 });
  });

  it("401 when locals.user is absent", async () => {
    await expect(POST(evt("claim", { user: null }))).rejects.toMatchObject({
      status: 401,
    });
  });

  it("403 when user lacks GK role for claim", async () => {
    await expect(POST(evt("claim", { user: viewerUser }))).rejects.toMatchObject({
      status: 403,
    });
  });

  it("403 when admin tier without GK role tries claim (role required)", async () => {
    await expect(
      POST(evt("claim", { user: adminNoRoleUser })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("403 when GK-role + mod tier attempts permreject (admin tier required)", async () => {
    await expect(
      POST(
        evt("permreject", { body: { ...validBody, reason: "x" } }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("200 admin without GK role CAN permreject", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    const res = await POST(
      evt("permreject", {
        user: adminNoRoleUser,
        body: { ...validBody, reason: "policy" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("200 admin without GK role CAN unclaim (admin override)", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    const res = await POST(
      evt("unclaim", { user: adminNoRoleUser }),
    );
    expect(res.status).toBe(200);
  });

  it("200 owner can do anything regardless of role", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    const res = await POST(
      evt("claim", {
        user: { id: "u1", tier: "owner", roles: [] },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("400 on invalid JSON", async () => {
    await expect(
      POST(evt("claim", { rawBody: "garbage", body: undefined })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when appId missing", async () => {
    await expect(POST(evt("claim", { body: {} }))).rejects.toMatchObject({
      status: 400,
    });
  });

  it("400 when appId is not a UUID", async () => {
    await expect(
      POST(evt("claim", { body: { appId: "junk" } })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when kick has no reason", async () => {
    await expect(POST(evt("kick"))).rejects.toMatchObject({ status: 400 });
  });

  it("400 when vote_out has no reason", async () => {
    await expect(POST(evt("vote_out"))).rejects.toMatchObject({ status: 400 });
  });

  it("200 claim happy path forwards appId without reason", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    const res = await POST(evt("claim"));
    expect(res.status).toBe(200);
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/review/claim", {
      userId: "u1",
      tier: "mod",
      appId: validAppId,
    });
  });

  it("200 approve happy path", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    const res = await POST(evt("approve"));
    expect(res.status).toBe(200);
  });

  it("200 reject forwards optional reason when present", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    await POST(evt("reject", { body: { ...validBody, reason: "duplicate" } }));
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/review/reject", {
      userId: "u1",
      tier: "mod",
      appId: validAppId,
      reason: "duplicate",
    });
  });

  it("404 when bot error includes 'not found'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Application not found",
    });
    const res = await POST(evt("claim"));
    expect(res.status).toBe(404);
  });

  it("409 when bot error includes 'already claimed'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "already claimed",
    });
    const res = await POST(evt("claim"));
    expect(res.status).toBe(409);
  });

  it("409 when bot error includes 'claimed by another'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "claimed by another reviewer",
    });
    const res = await POST(evt("claim"));
    expect(res.status).toBe(409);
  });

  it("403 when bot error mentions permission", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "permission denied at bot side",
    });
    const res = await POST(evt("claim"));
    expect(res.status).toBe(403);
  });

  it("502 when bot error includes 'offline'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Bot is offline",
    });
    const res = await POST(evt("claim"));
    expect(res.status).toBe(502);
  });

  it("400 fallback on generic bot error", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "rate limited",
    });
    const res = await POST(evt("claim"));
    expect(res.status).toBe(400);
  });
});
