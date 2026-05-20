// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/art.jobs.cancel.test.ts
 * WHAT: Unit tests for /api/art/jobs/cancel POST handler.
 * WHY: Cancellation is the only undo for an in-progress art commission;
 *      tier gate (sm) and the "not found" -> 404 mapping must stay stable.
 *      The optional `reason` field also goes through the bot API verbatim;
 *      pin the pass-through so a future "always-required" tightening would
 *      fail loudly here.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { mockCallBotApi } = vi.hoisted(() => ({ mockCallBotApi: vi.fn() }));

vi.mock("$lib/server/botApi", () => ({ callBotApi: mockCallBotApi }));

const { POST } = await import(
  "../../../web/src/routes/api/art/jobs/cancel/+server.js"
);

const smUser = { id: "u1", tier: "sm" } as const;

beforeEach(() => {
  mockCallBotApi.mockReset();
});

describe("POST /api/art/jobs/cancel", () => {
  it("401 when locals.user is absent", async () => {
    await expect(
      POST(makeEvent({ user: null, body: { jobId: 1 } })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("403 when tier below sm", async () => {
    await expect(
      POST(
        makeEvent({
          user: { id: "u1", tier: "mod" },
          body: { jobId: 1 },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("400 on invalid JSON", async () => {
    await expect(
      POST(makeEvent({ user: smUser, rawBody: "x" })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when jobId missing", async () => {
    await expect(
      POST(makeEvent({ user: smUser, body: {} })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("200 happy path forwards reason when supplied", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    await POST(
      makeEvent({ user: smUser, body: { jobId: 7, reason: "duplicate" } }),
    );
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/art/jobs/cancel", {
      userId: "u1",
      tier: "sm",
      jobId: 7,
      reason: "duplicate",
    });
  });

  it("200 happy path with reason undefined passes undefined through", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    await POST(makeEvent({ user: smUser, body: { jobId: 7 } }));
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/art/jobs/cancel", {
      userId: "u1",
      tier: "sm",
      jobId: 7,
      reason: undefined,
    });
  });

  it("404 when bot error includes 'not found'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Job not found",
    });
    const res = await POST(makeEvent({ user: smUser, body: { jobId: 7 } }));
    expect(res.status).toBe(404);
  });

  it("400 fallback on generic bot error", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "validation failed",
    });
    const res = await POST(makeEvent({ user: smUser, body: { jobId: 7 } }));
    expect(res.status).toBe(400);
  });
});
