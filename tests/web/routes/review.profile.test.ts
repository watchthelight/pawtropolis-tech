// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/review.profile.test.ts
 * WHAT: Unit tests for the dashboard's /api/review/profile POST handler.
 * WHY: Route is read-only but fans out to two networks (bot Fastify API +
 *      Cloudflare profile proxy). The status-mapping branches were never
 *      exercised. This locks in auth gating, body validation, and the
 *      bot-error -> HTTP-status translation.
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
  "../../../web/src/routes/api/review/profile/+server.js"
);

const gkUser = { id: "u1", tier: "gk" } as const;

beforeEach(() => {
  mockCallBotApi.mockReset();
  delete process.env.DISCORD_PROFILE_PROXY_URL;
  delete process.env.DISCORD_PROFILE_PROXY_SECRET;
  process.env.GUILD_ID = "g1";
});

describe("POST /api/review/profile", () => {
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

  it("403 when tier is none", async () => {
    const event = makeEvent({
      user: { id: "u1", tier: "none" },
      body: { targetUserId: "t1" },
    });
    await expect(POST(event)).rejects.toMatchObject({ status: 403 });
  });

  it("400 on invalid JSON body", async () => {
    const event = makeEvent({ user: gkUser, rawBody: "not-json{" });
    await expect(POST(event)).rejects.toMatchObject({ status: 400 });
  });

  it("400 when targetUserId is missing", async () => {
    const event = makeEvent({ user: gkUser, body: {} });
    await expect(POST(event)).rejects.toMatchObject({ status: 400 });
  });

  it("400 when targetUserId is empty string", async () => {
    const event = makeEvent({ user: gkUser, body: { targetUserId: "" } });
    await expect(POST(event)).rejects.toMatchObject({ status: 400 });
  });

  it("200 happy path: bot success, no proxy configured -> bio null", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: true,
      data: { username: "alice", customStatus: "from-bot" },
    });

    const event = makeEvent({ user: gkUser, body: { targetUserId: "t1" } });
    const res = await POST(event);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      success: true,
      data: {
        username: "alice",
        bio: null,
        customStatus: "from-bot",
      },
    });
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/review/profile", {
      userId: "u1",
      tier: "gk",
      targetUserId: "t1",
    });
  });

  it("200: proxy returns bio + customStatus, overrides bot customStatus", async () => {
    // Module constants snapshot env at import time. Reset and re-import with
    // proxy env populated so fetchDiscordProfile actually attempts the call.
    process.env.DISCORD_PROFILE_PROXY_URL = "https://proxy.example/profile";
    process.env.DISCORD_PROFILE_PROXY_SECRET = "secret";

    vi.resetModules();
    const { POST: PostWithProxy } = await import(
      "../../../web/src/routes/api/review/profile/+server.js"
    );

    mockCallBotApi.mockResolvedValueOnce({
      success: true,
      data: { username: "alice", customStatus: "stale-from-bot" },
    });

    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({ bio: "I love art.", customStatus: "fresh-from-proxy" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const event = makeEvent({ user: gkUser, body: { targetUserId: "t1" } });
      const res = await PostWithProxy(event);
      const json = await res.json();

      expect(json.data.bio).toBe("I love art.");
      expect(json.data.customStatus).toBe("fresh-from-proxy");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("404 when bot error message contains 'not found'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "user not found in audit table",
    });

    const event = makeEvent({ user: gkUser, body: { targetUserId: "t1" } });
    const res = await POST(event);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("502 when bot error contains 'unreachable'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Bot API unreachable",
    });

    const event = makeEvent({ user: gkUser, body: { targetUserId: "t1" } });
    const res = await POST(event);
    expect(res.status).toBe(502);
  });

  it("400 fallback when bot error is generic", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "internal validation failed",
    });

    const event = makeEvent({ user: gkUser, body: { targetUserId: "t1" } });
    const res = await POST(event);
    expect(res.status).toBe(400);
  });
});
