// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/art.jobs.create.test.ts
 * WHAT: Unit tests for /api/art/jobs/create POST handler.
 * WHY: Creates an art commission; the 409 "No available" path signals the
 *      artist roster is full and must surface to the UI distinctly from
 *      generic 400s. Three required fields means the missing-field branch
 *      is the most likely to silently relax later.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { mockCallBotApi } = vi.hoisted(() => ({ mockCallBotApi: vi.fn() }));

vi.mock("$lib/server/botApi", () => ({ callBotApi: mockCallBotApi }));

const { POST } = await import(
  "../../../web/src/routes/api/art/jobs/create/+server.js"
);

const smUser = { id: "u1", tier: "sm" } as const;
const validBody = {
  artistId: "a1",
  recipientId: "r1",
  ticketType: "commission",
  notes: "test note",
};

beforeEach(() => {
  mockCallBotApi.mockReset();
});

describe("POST /api/art/jobs/create", () => {
  it("401 when locals.user is absent", async () => {
    await expect(
      POST(makeEvent({ user: null, body: validBody })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("403 when tier below sm", async () => {
    await expect(
      POST(makeEvent({ user: { id: "u1", tier: "mod" }, body: validBody })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("400 on invalid JSON", async () => {
    await expect(
      POST(makeEvent({ user: smUser, rawBody: "x" })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when artistId missing", async () => {
    const body = { ...validBody, artistId: undefined };
    await expect(
      POST(makeEvent({ user: smUser, body })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when recipientId missing", async () => {
    const body = { ...validBody, recipientId: undefined };
    await expect(
      POST(makeEvent({ user: smUser, body })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when ticketType missing", async () => {
    const body = { ...validBody, ticketType: undefined };
    await expect(
      POST(makeEvent({ user: smUser, body })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("200 happy path forwards all fields including notes", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: { jobId: 9 } });
    await POST(makeEvent({ user: smUser, body: validBody }));
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/art/jobs/create", {
      userId: "u1",
      tier: "sm",
      artistId: "a1",
      recipientId: "r1",
      ticketType: "commission",
      notes: "test note",
    });
  });

  it("409 when bot error includes 'No available'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "No available artists in the queue",
    });
    const res = await POST(makeEvent({ user: smUser, body: validBody }));
    expect(res.status).toBe(409);
  });

  it("400 fallback on generic bot error", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "validation failed",
    });
    const res = await POST(makeEvent({ user: smUser, body: validBody }));
    expect(res.status).toBe(400);
  });
});
