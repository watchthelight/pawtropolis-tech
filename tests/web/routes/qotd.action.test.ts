// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/qotd.action.test.ts
 * WHAT: Unit tests for /api/qotd/[action] POST handler.
 * WHY: Per-action tier table (restore needs `sm`, others `gk`) is easy to
 *      get wrong on a copy-paste. Conditional payload fields (reason on
 *      reject, question on edit) are passed only when type is string -- the
 *      typeof guards have caused regressions before in similar handlers.
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
  "../../../web/src/routes/api/qotd/[action]/+server.js"
);

const gkUser = { id: "u1", tier: "gk" } as const;
const smUser = { id: "u1", tier: "sm" } as const;
const validBody = { suggestionId: 42 };

beforeEach(() => {
  mockCallBotApi.mockReset();
});

function evt(
  action: string,
  overrides: Partial<Parameters<typeof makeEvent>[0]> = {},
) {
  return makeEvent({
    user: gkUser,
    params: { action },
    body: validBody,
    ...overrides,
  });
}

describe("POST /api/qotd/[action]", () => {
  it("401 when locals.user is absent", async () => {
    await expect(POST(evt("approve", { user: null }))).rejects.toMatchObject({
      status: 401,
    });
  });

  it("404 on unknown action", async () => {
    await expect(POST(evt("yeet"))).rejects.toMatchObject({ status: 404 });
  });

  it("403 when viewer attempts approve", async () => {
    await expect(
      POST(evt("approve", { user: { id: "u1", tier: "viewer" } })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("403 when gk attempts restore (restore is sm-only)", async () => {
    await expect(POST(evt("restore"))).rejects.toMatchObject({ status: 403 });
  });

  it("400 on invalid JSON", async () => {
    await expect(
      POST(evt("approve", { rawBody: "garbage", body: undefined })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when suggestionId missing", async () => {
    await expect(
      POST(evt("approve", { body: {} })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when suggestionId is not a positive integer", async () => {
    await expect(
      POST(evt("approve", { body: { suggestionId: -1 } })),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      POST(evt("approve", { body: { suggestionId: 1.5 } })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("200 approve happy as gk forwards basic payload", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    await POST(evt("approve"));
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/qotd/approve", {
      userId: "u1",
      tier: "gk",
      suggestionId: 42,
    });
  });

  it("200 use happy as gk", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    const res = await POST(evt("use"));
    expect(res.status).toBe(200);
  });

  it("200 restore happy as sm", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    const res = await POST(
      evt("restore", { user: smUser }),
    );
    expect(res.status).toBe(200);
  });

  it("reject forwards reason when it is a string", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    await POST(
      evt("reject", { body: { suggestionId: 42, reason: "too spicy" } }),
    );
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/qotd/reject", {
      userId: "u1",
      tier: "gk",
      suggestionId: 42,
      reason: "too spicy",
    });
  });

  it("reject drops reason when non-string", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    await POST(
      evt("reject", { body: { suggestionId: 42, reason: 123 } }),
    );
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/qotd/reject", {
      userId: "u1",
      tier: "gk",
      suggestionId: 42,
    });
  });

  it("edit forwards question when it is a string", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    await POST(
      evt("edit", { body: { suggestionId: 42, question: "rewritten?" } }),
    );
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/qotd/edit", {
      userId: "u1",
      tier: "gk",
      suggestionId: 42,
      question: "rewritten?",
    });
  });

  it("404 when bot error includes 'not found'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Suggestion not found",
    });
    const res = await POST(evt("approve"));
    expect(res.status).toBe(404);
  });

  it("409 when bot error includes 'not pending'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Suggestion is not pending",
    });
    const res = await POST(evt("approve"));
    expect(res.status).toBe(409);
  });

  it("409 when bot error includes 'not in a restorable'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Suggestion is not in a restorable state",
    });
    const res = await POST(evt("restore", { user: smUser }));
    expect(res.status).toBe(409);
  });

  it("502 when bot error includes 'unreachable'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Bot API unreachable",
    });
    const res = await POST(evt("approve"));
    expect(res.status).toBe(502);
  });

  it("400 fallback on generic bot error", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "rate limited",
    });
    const res = await POST(evt("approve"));
    expect(res.status).toBe(400);
  });
});
