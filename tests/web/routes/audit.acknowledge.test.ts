// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/audit.acknowledge.test.ts
 * WHAT: Unit tests for /api/audit/acknowledge POST handler.
 * WHY: Acknowledging a security finding is a privileged write (tier `sa`
 *      minimum) that captures a `permissionHash` for tamper detection on the
 *      bot side. The handler must reject below-tier users AND missing-field
 *      payloads with distinct codes; both belong to compliance review.
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
  "../../../web/src/routes/api/audit/acknowledge/+server.js"
);

const saUser = { id: "u1", tier: "sa" } as const;
const validBody = {
  issueKey: "missing-2fa",
  severity: "high",
  title: "User lacks 2FA",
  permissionHash: "abc123",
  reason: "approved by admin",
};

beforeEach(() => {
  mockCallBotApi.mockReset();
});

describe("POST /api/audit/acknowledge", () => {
  it("401 when locals.user is absent", async () => {
    await expect(
      POST(makeEvent({ user: null, body: validBody })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("403 when tier below sa (mod is allowed many places but not here)", async () => {
    await expect(
      POST(makeEvent({ user: { id: "u1", tier: "mod" }, body: validBody })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("403 when tier is gk", async () => {
    await expect(
      POST(makeEvent({ user: { id: "u1", tier: "gk" }, body: validBody })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("400 on invalid JSON", async () => {
    await expect(
      POST(makeEvent({ user: saUser, rawBody: "nope" })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when issueKey missing", async () => {
    const body = { ...validBody, issueKey: undefined };
    await expect(
      POST(makeEvent({ user: saUser, body })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when permissionHash missing", async () => {
    const body = { ...validBody, permissionHash: undefined };
    await expect(
      POST(makeEvent({ user: saUser, body })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("200 happy path forwards all required fields plus reason", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: true,
      data: { acknowledged: true },
    });
    const res = await POST(makeEvent({ user: saUser, body: validBody }));
    expect(res.status).toBe(200);
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/audit/acknowledge", {
      userId: "u1",
      tier: "sa",
      issueKey: "missing-2fa",
      severity: "high",
      title: "User lacks 2FA",
      permissionHash: "abc123",
      reason: "approved by admin",
    });
  });

  it("403 when bot error mentions 'permission'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "permission hash mismatch",
    });
    const res = await POST(makeEvent({ user: saUser, body: validBody }));
    expect(res.status).toBe(403);
  });

  it("400 fallback on generic bot error", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "validation failed",
    });
    const res = await POST(makeEvent({ user: saUser, body: validBody }));
    expect(res.status).toBe(400);
  });
});
