// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/art.jobs.finish.test.ts
 * WHAT: Unit tests for /api/art/jobs/finish POST handler.
 * WHY: Dual-path auth: SM-tier staff can finish ANY job; a non-staff user
 *      with the SERVER_ARTIST role (`896070888749940770`) can finish their
 *      OWN. Both code paths plus the "own" 403 branch (when bot rejects an
 *      artist trying to close someone else's job) need explicit coverage --
 *      the role check is the most likely place for a silent privilege
 *      regression.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { mockCallBotApi } = vi.hoisted(() => ({ mockCallBotApi: vi.fn() }));

vi.mock("$lib/server/botApi", () => ({ callBotApi: mockCallBotApi }));

const { POST } = await import(
  "../../../web/src/routes/api/art/jobs/finish/+server.js"
);

const SERVER_ARTIST = "896070888749940770";

const smStaff = { id: "u1", tier: "sm" as const, roles: [] };
const artistViewer = {
  id: "u2",
  tier: "viewer" as const,
  roles: [SERVER_ARTIST],
};
const plainViewer = { id: "u3", tier: "viewer" as const, roles: [] };

beforeEach(() => {
  mockCallBotApi.mockReset();
});

describe("POST /api/art/jobs/finish", () => {
  it("401 when locals.user is absent", async () => {
    await expect(
      POST(makeEvent({ user: null, body: { jobId: 1 } })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("403 when tier below sm AND no SERVER_ARTIST role", async () => {
    await expect(
      POST(makeEvent({ user: plainViewer, body: { jobId: 1 } })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("200 allowed when sm staff with no artist role", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    const res = await POST(makeEvent({ user: smStaff, body: { jobId: 1 } }));
    expect(res.status).toBe(200);
  });

  it("200 allowed when viewer with SERVER_ARTIST role", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    const res = await POST(
      makeEvent({ user: artistViewer, body: { jobId: 1 } }),
    );
    expect(res.status).toBe(200);
  });

  it("400 on invalid JSON", async () => {
    await expect(
      POST(makeEvent({ user: smStaff, rawBody: "x" })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when jobId missing", async () => {
    await expect(
      POST(makeEvent({ user: smStaff, body: {} })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("200 happy forwards user tier (artist sends 'viewer')", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    await POST(makeEvent({ user: artistViewer, body: { jobId: 7 } }));
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/art/jobs/finish", {
      userId: "u2",
      tier: "viewer",
      jobId: 7,
    });
  });

  it("404 when bot error includes 'not found'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Job not found",
    });
    const res = await POST(makeEvent({ user: smStaff, body: { jobId: 7 } }));
    expect(res.status).toBe(404);
  });

  it("403 when bot error includes 'own' (artist tried someone else's job)", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Artists can only finish their own jobs",
    });
    const res = await POST(
      makeEvent({ user: artistViewer, body: { jobId: 7 } }),
    );
    expect(res.status).toBe(403);
  });

  it("400 fallback on generic bot error", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "validation failed",
    });
    const res = await POST(makeEvent({ user: smStaff, body: { jobId: 7 } }));
    expect(res.status).toBe(400);
  });
});
