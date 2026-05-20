// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/scan.test.ts
 * WHAT: Unit tests for /api/scan/[appId]/[scanType] POST handler.
 * WHY: First parameterized route under test. Validates the makeEvent params
 *      extension end-to-end, locks the scanType allowlist (`nsfw`, `ai`),
 *      the UUID format guard on appId, and the 5-way bot-error -> status map
 *      (including the rarely-tested 500 branch on "failed" errors).
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
  "../../../web/src/routes/api/scan/[appId]/[scanType]/+server.js"
);

const gkUser = { id: "u1", tier: "gk" } as const;
const validAppId = "01234567-89ab-cdef-0123-456789abcdef";
const validParams = { appId: validAppId, scanType: "nsfw" };

beforeEach(() => {
  mockCallBotApi.mockReset();
});

function evt(overrides: Partial<Parameters<typeof makeEvent>[0]> = {}) {
  return makeEvent({
    user: gkUser,
    params: validParams,
    method: "POST",
    body: undefined,
    ...overrides,
  });
}

describe("POST /api/scan/[appId]/[scanType]", () => {
  it("404 on unknown scanType (checked before auth)", async () => {
    await expect(
      POST(evt({ params: { ...validParams, scanType: "junk" } })),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("401 when locals.user is absent", async () => {
    await expect(POST(evt({ user: null }))).rejects.toMatchObject({
      status: 401,
    });
  });

  it("403 when tier below gk", async () => {
    await expect(
      POST(evt({ user: { id: "u1", tier: "viewer" } })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("400 when appId is not a UUID", async () => {
    await expect(
      POST(evt({ params: { ...validParams, appId: "not-a-uuid" } })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("200 happy path for scanType=nsfw forwards correct bot path + body", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: { ok: 1 } });
    const res = await POST(evt());
    expect(res.status).toBe(200);
    expect(mockCallBotApi).toHaveBeenCalledWith(
      `/api/scan/${validAppId}/nsfw`,
      { userId: "u1", tier: "gk", appId: validAppId },
      30_000,
    );
  });

  it("200 happy path for scanType=ai", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: { ok: 1 } });
    const res = await POST(
      evt({ params: { ...validParams, scanType: "ai" } }),
    );
    expect(res.status).toBe(200);
    expect(mockCallBotApi).toHaveBeenCalledWith(
      `/api/scan/${validAppId}/ai`,
      expect.any(Object),
      30_000,
    );
  });

  it("404 when bot error includes 'not found'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Application not found",
    });
    const res = await POST(evt());
    expect(res.status).toBe(404);
  });

  it("403 when bot error includes 'permission'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "permission denied",
    });
    const res = await POST(evt());
    expect(res.status).toBe(403);
  });

  it("403 when bot error includes 'insufficient'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "insufficient credits",
    });
    const res = await POST(evt());
    expect(res.status).toBe(403);
  });

  it("502 when bot error includes 'offline'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "scanner is offline",
    });
    const res = await POST(evt());
    expect(res.status).toBe(502);
  });

  it("500 when bot error includes 'failed'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "image processing failed",
    });
    const res = await POST(evt());
    expect(res.status).toBe(500);
  });

  it("400 fallback on generic bot error", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "rate limited",
    });
    const res = await POST(evt());
    expect(res.status).toBe(400);
  });
});
