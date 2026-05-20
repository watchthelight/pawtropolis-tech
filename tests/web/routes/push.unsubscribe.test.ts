// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/push.unsubscribe.test.ts
 * WHAT: Unit tests for /api/push/unsubscribe POST handler.
 * WHY: Browser sends this when revoking notification permission. The
 *      `endpoint` is the only identifier on the row, so omitting validation
 *      would silently no-op and the user would still receive pushes.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { mockRemove } = vi.hoisted(() => ({ mockRemove: vi.fn() }));

vi.mock("$lib/server/push/push-db", () => ({
  removeSubscription: mockRemove,
}));

const { POST } = await import(
  "../../../web/src/routes/api/push/unsubscribe/+server.js"
);

const gkUser = { id: "u1", tier: "gk" } as const;
const endpoint = "https://fcm.googleapis.com/fcm/send/abc123";

beforeEach(() => {
  mockRemove.mockReset();
});

describe("POST /api/push/unsubscribe", () => {
  it("401 when locals.user is absent", async () => {
    await expect(
      POST(makeEvent({ user: null, body: { endpoint } })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("400 on invalid JSON", async () => {
    await expect(
      POST(makeEvent({ user: gkUser, rawBody: "x" })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when endpoint missing", async () => {
    await expect(
      POST(makeEvent({ user: gkUser, body: {} })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when endpoint is empty string", async () => {
    await expect(
      POST(makeEvent({ user: gkUser, body: { endpoint: "" } })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("200 happy path calls removeSubscription with endpoint", async () => {
    const res = await POST(
      makeEvent({ user: gkUser, body: { endpoint } }),
    );
    expect(res.status).toBe(200);
    expect(mockRemove).toHaveBeenCalledWith(endpoint);
  });
});
