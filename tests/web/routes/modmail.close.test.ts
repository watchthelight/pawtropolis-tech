// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/modmail.close.test.ts
 * WHAT: Unit tests for /api/modmail/close POST handler.
 * WHY: 404/409/502/400 status branches map from bot error substrings; the
 *      "already closed" path is the easiest to silently break with a
 *      copy-paste typo, so it gets explicit coverage here.
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
  "../../../web/src/routes/api/modmail/close/+server.js"
);

const gkUser = { id: "u1", tier: "gk" } as const;
const validBody = { ticketId: 42 };

beforeEach(() => {
  mockCallBotApi.mockReset();
});

describe("POST /api/modmail/close", () => {
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
      POST(makeEvent({ user: gkUser, rawBody: "{nope" })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when ticketId missing", async () => {
    await expect(
      POST(makeEvent({ user: gkUser, body: {} })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when ticketId is 0 (falsy)", async () => {
    await expect(
      POST(makeEvent({ user: gkUser, body: { ticketId: 0 } })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("200 happy path", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: true,
      data: { closed: true },
    });
    const res = await POST(makeEvent({ user: gkUser, body: validBody }));
    expect(res.status).toBe(200);
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/modmail/close", {
      userId: "u1",
      tier: "gk",
      ticketId: 42,
    });
  });

  it("404 when bot error includes 'not found'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Ticket not found",
    });
    const res = await POST(makeEvent({ user: gkUser, body: validBody }));
    expect(res.status).toBe(404);
  });

  it("409 when bot error includes 'already closed'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Ticket is already closed",
    });
    const res = await POST(makeEvent({ user: gkUser, body: validBody }));
    expect(res.status).toBe(409);
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

  it("400 fallback on generic error", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "validation failed",
    });
    const res = await POST(makeEvent({ user: gkUser, body: validBody }));
    expect(res.status).toBe(400);
  });
});
