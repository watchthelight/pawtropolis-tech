// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/modmail.send.test.ts
 * WHAT: Unit tests for the dashboard's /api/modmail/send POST handler.
 * WHY: This route writes through to the bot API which then talks to Discord.
 *      The 4-way status mapping (404 / 409 / 502 / 400) is brittle: it parses
 *      bot error strings via case-insensitive contains checks. Lock the
 *      mapping so future error-message tweaks on the bot side don't silently
 *      shift the HTTP contract.
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
  "../../../web/src/routes/api/modmail/send/+server.js"
);

const gkUser = { id: "u1", tier: "gk" } as const;
const validBody = { ticketId: 42, content: "hello" };

beforeEach(() => {
  mockCallBotApi.mockReset();
});

describe("POST /api/modmail/send", () => {
  it("401 when locals.user is absent", async () => {
    const event = makeEvent({ user: null, body: validBody });
    await expect(POST(event)).rejects.toMatchObject({ status: 401 });
  });

  it("403 when tier below gk", async () => {
    const event = makeEvent({
      user: { id: "u1", tier: "viewer" },
      body: validBody,
    });
    await expect(POST(event)).rejects.toMatchObject({ status: 403 });
  });

  it("400 on invalid JSON", async () => {
    const event = makeEvent({ user: gkUser, rawBody: "{not json" });
    await expect(POST(event)).rejects.toMatchObject({ status: 400 });
  });

  it("400 when ticketId missing", async () => {
    const event = makeEvent({ user: gkUser, body: { content: "hi" } });
    await expect(POST(event)).rejects.toMatchObject({ status: 400 });
  });

  it("400 when content missing", async () => {
    const event = makeEvent({ user: gkUser, body: { ticketId: 42 } });
    await expect(POST(event)).rejects.toMatchObject({ status: 400 });
  });

  it("400 when content exceeds 2000 chars", async () => {
    const event = makeEvent({
      user: gkUser,
      body: { ticketId: 42, content: "x".repeat(2001) },
    });
    await expect(POST(event)).rejects.toMatchObject({ status: 400 });
  });

  it("200 happy path forwards to bot API", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: true,
      data: { messageId: "m1" },
    });

    const event = makeEvent({ user: gkUser, body: validBody });
    const res = await POST(event);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ success: true, data: { messageId: "m1" } });
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/modmail/send", {
      userId: "u1",
      tier: "gk",
      ticketId: 42,
      content: "hello",
    });
  });

  it("404 when bot error includes 'not found'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Ticket NOT FOUND",
    });
    const event = makeEvent({ user: gkUser, body: validBody });
    const res = await POST(event);
    expect(res.status).toBe(404);
  });

  it("409 when bot error includes 'not open'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Ticket is not open",
    });
    const event = makeEvent({ user: gkUser, body: validBody });
    const res = await POST(event);
    expect(res.status).toBe(409);
  });

  it("502 when bot error includes 'unreachable'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Bot API unreachable",
    });
    const event = makeEvent({ user: gkUser, body: validBody });
    const res = await POST(event);
    expect(res.status).toBe(502);
  });

  it("502 when bot error includes 'timed out'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Bot API request timed out",
    });
    const event = makeEvent({ user: gkUser, body: validBody });
    const res = await POST(event);
    expect(res.status).toBe(502);
  });

  it("400 fallback when bot error is generic", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "rate limit exceeded",
    });
    const event = makeEvent({ user: gkUser, body: validBody });
    const res = await POST(event);
    expect(res.status).toBe(400);
  });
});
