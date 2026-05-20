// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/modmail.open.test.ts
 * WHAT: Unit tests for the dashboard's /api/modmail/open POST handler.
 * WHY: Opens a modmail thread by passing through to the bot. Three error
 *      modes route to distinct HTTP statuses (404 / 409 / 502) via substring
 *      matching on bot error strings; lock the contract.
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
  "../../../web/src/routes/api/modmail/open/+server.js"
);

const gkUser = { id: "u1", tier: "gk" } as const;

beforeEach(() => {
  mockCallBotApi.mockReset();
});

describe("POST /api/modmail/open", () => {
  it("401 when locals.user is absent", async () => {
    const event = makeEvent({ user: null, body: { targetUserId: "t1" } });
    await expect(POST(event)).rejects.toMatchObject({ status: 401 });
  });

  it("403 when tier below gk", async () => {
    const event = makeEvent({
      user: { id: "u1", tier: "viewer" },
      body: { targetUserId: "t1" },
    });
    await expect(POST(event)).rejects.toMatchObject({ status: 403 });
  });

  it("400 on invalid JSON", async () => {
    const event = makeEvent({ user: gkUser, rawBody: "not-json" });
    await expect(POST(event)).rejects.toMatchObject({ status: 400 });
  });

  it("400 when targetUserId is missing", async () => {
    const event = makeEvent({ user: gkUser, body: {} });
    await expect(POST(event)).rejects.toMatchObject({ status: 400 });
  });

  it("200 happy path passes targetUserId only when appCode absent", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: true,
      data: { ticketId: 7 },
    });
    const event = makeEvent({ user: gkUser, body: { targetUserId: "t1" } });
    const res = await POST(event);
    expect(res.status).toBe(200);
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/modmail/open", {
      userId: "u1",
      tier: "gk",
      targetUserId: "t1",
    });
  });

  it("200 forwards appCode when supplied", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    const event = makeEvent({
      user: gkUser,
      body: { targetUserId: "t1", appCode: "A-42" },
    });
    await POST(event);
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/modmail/open", {
      userId: "u1",
      tier: "gk",
      targetUserId: "t1",
      appCode: "A-42",
    });
  });

  it("404 when bot error includes 'not found'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "user not found",
    });
    const res = await POST(
      makeEvent({ user: gkUser, body: { targetUserId: "t1" } }),
    );
    expect(res.status).toBe(404);
  });

  it("404 when bot error includes 'not configured'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "modmail not configured for guild",
    });
    const res = await POST(
      makeEvent({ user: gkUser, body: { targetUserId: "t1" } }),
    );
    expect(res.status).toBe(404);
  });

  it("409 when bot error includes 'already has'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "user already has an open ticket",
    });
    const res = await POST(
      makeEvent({ user: gkUser, body: { targetUserId: "t1" } }),
    );
    expect(res.status).toBe(409);
  });

  it("502 on bot unreachable", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Bot API unreachable",
    });
    const res = await POST(
      makeEvent({ user: gkUser, body: { targetUserId: "t1" } }),
    );
    expect(res.status).toBe(502);
  });

  it("400 fallback when bot error is generic", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "permission denied",
    });
    const res = await POST(
      makeEvent({ user: gkUser, body: { targetUserId: "t1" } }),
    );
    expect(res.status).toBe(400);
  });
});
