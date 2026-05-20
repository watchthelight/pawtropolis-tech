// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/audit.unacknowledge.test.ts
 * WHAT: Unit tests for /api/audit/unacknowledge POST handler.
 * WHY: Reverses an acknowledge. Tier gate is `sa`. The single non-default
 *      status branch (404 on "not acknowledged") is one substring check from
 *      mapping to 400 by accident.
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
  "../../../web/src/routes/api/audit/unacknowledge/+server.js"
);

const saUser = { id: "u1", tier: "sa" } as const;
const validBody = { issueKey: "missing-2fa" };

beforeEach(() => {
  mockCallBotApi.mockReset();
});

describe("POST /api/audit/unacknowledge", () => {
  it("401 when locals.user is absent", async () => {
    await expect(
      POST(makeEvent({ user: null, body: validBody })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("403 when tier below sa", async () => {
    await expect(
      POST(makeEvent({ user: { id: "u1", tier: "admin" }, body: validBody })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("400 on invalid JSON", async () => {
    await expect(
      POST(makeEvent({ user: saUser, rawBody: "{" })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when issueKey missing", async () => {
    await expect(
      POST(makeEvent({ user: saUser, body: {} })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("200 happy path", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: true,
      data: { unacknowledged: true },
    });
    const res = await POST(makeEvent({ user: saUser, body: validBody }));
    expect(res.status).toBe(200);
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/audit/unacknowledge", {
      userId: "u1",
      tier: "sa",
      issueKey: "missing-2fa",
    });
  });

  it("404 when bot error includes 'not acknowledged'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Issue was not acknowledged",
    });
    const res = await POST(makeEvent({ user: saUser, body: validBody }));
    expect(res.status).toBe(404);
  });

  it("400 fallback on generic error", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Database write failed",
    });
    const res = await POST(makeEvent({ user: saUser, body: validBody }));
    expect(res.status).toBe(400);
  });
});
