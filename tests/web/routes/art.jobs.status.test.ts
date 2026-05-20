// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/art.jobs.status.test.ts
 * WHAT: Unit tests for /api/art/jobs/status POST handler.
 * WHY: Same dual-path auth as finish (sm OR SERVER_ARTIST role), but
 *      requires both jobId AND status. The status field is what tells the
 *      bot to transition the job lifecycle (e.g. "in_progress" -> "done")
 *      -- forgetting it would silently no-op on the bot side, so the
 *      missing-status validation must stay tight.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { mockCallBotApi } = vi.hoisted(() => ({ mockCallBotApi: vi.fn() }));

vi.mock("$lib/server/botApi", () => ({ callBotApi: mockCallBotApi }));

const { POST } = await import(
  "../../../web/src/routes/api/art/jobs/status/+server.js"
);

const SERVER_ARTIST = "896070888749940770";

const smStaff = { id: "u1", tier: "sm" as const, roles: [] };
const artistViewer = {
  id: "u2",
  tier: "viewer" as const,
  roles: [SERVER_ARTIST],
};
const validBody = { jobId: 1, status: "in_progress" };

beforeEach(() => {
  mockCallBotApi.mockReset();
});

describe("POST /api/art/jobs/status", () => {
  it("401 when locals.user is absent", async () => {
    await expect(
      POST(makeEvent({ user: null, body: validBody })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("403 when tier below sm and no SERVER_ARTIST role", async () => {
    await expect(
      POST(
        makeEvent({
          user: { id: "u1", tier: "viewer", roles: [] },
          body: validBody,
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("200 when sm staff", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    const res = await POST(makeEvent({ user: smStaff, body: validBody }));
    expect(res.status).toBe(200);
  });

  it("200 when artist viewer", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    const res = await POST(makeEvent({ user: artistViewer, body: validBody }));
    expect(res.status).toBe(200);
  });

  it("400 on invalid JSON", async () => {
    await expect(
      POST(makeEvent({ user: smStaff, rawBody: "x" })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when jobId missing", async () => {
    await expect(
      POST(makeEvent({ user: smStaff, body: { status: "done" } })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when status missing", async () => {
    await expect(
      POST(makeEvent({ user: smStaff, body: { jobId: 7 } })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("200 happy path forwards both fields", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    await POST(makeEvent({ user: smStaff, body: validBody }));
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/art/jobs/status", {
      userId: "u1",
      tier: "sm",
      jobId: 1,
      status: "in_progress",
    });
  });

  it("404 when bot error includes 'not found'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Job not found",
    });
    const res = await POST(makeEvent({ user: smStaff, body: validBody }));
    expect(res.status).toBe(404);
  });

  it("403 when bot error includes 'own'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Artists can only update their own jobs",
    });
    const res = await POST(makeEvent({ user: artistViewer, body: validBody }));
    expect(res.status).toBe(403);
  });

  it("400 fallback on generic bot error", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "validation failed",
    });
    const res = await POST(makeEvent({ user: smStaff, body: validBody }));
    expect(res.status).toBe(400);
  });
});
