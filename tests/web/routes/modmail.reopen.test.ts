// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/modmail.reopen.test.ts
 * WHAT: Unit tests for /api/modmail/reopen POST handler.
 * WHY: Adds a 410 Gone branch ("more than 7 days") on top of the standard
 *      404/409/502 map. The 410 path is the only place in the dashboard
 *      that uses that status, so a regression would be silent and surprising.
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
  "../../../web/src/routes/api/modmail/reopen/+server.js"
);

const gkUser = { id: "u1", tier: "gk" } as const;
const validBody = { ticketId: 42 };

beforeEach(() => {
  mockCallBotApi.mockReset();
});

describe("POST /api/modmail/reopen", () => {
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
      POST(makeEvent({ user: gkUser, rawBody: "garbage" })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when ticketId missing", async () => {
    await expect(
      POST(makeEvent({ user: gkUser, body: {} })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("200 happy path", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: true,
      data: { reopened: true },
    });
    const res = await POST(makeEvent({ user: gkUser, body: validBody }));
    expect(res.status).toBe(200);
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/modmail/reopen", {
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

  it("409 when bot error includes 'already open'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Ticket is already open",
    });
    const res = await POST(makeEvent({ user: gkUser, body: validBody }));
    expect(res.status).toBe(409);
  });

  it("410 when ticket closed more than 7 days", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Ticket closed more than 7 days ago",
    });
    const res = await POST(makeEvent({ user: gkUser, body: validBody }));
    expect(res.status).toBe(410);
  });

  it("502 on bot unreachable", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Bot API unreachable",
    });
    const res = await POST(makeEvent({ user: gkUser, body: validBody }));
    expect(res.status).toBe(502);
  });

  it("400 fallback on generic error", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "rate limited",
    });
    const res = await POST(makeEvent({ user: gkUser, body: validBody }));
    expect(res.status).toBe(400);
  });
});
