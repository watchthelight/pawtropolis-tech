// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/push.subscribe.test.ts
 * WHAT: Unit tests for /api/push/subscribe POST handler.
 * WHY: Web push registration is dropped on the floor if the subscription
 *      validation relaxes (a bad endpoint or missing keys means the
 *      browser silently never gets notifications later). The HTTPS-only
 *      check is also a soft security gate -- pin it so a "permit http for
 *      local dev" patch doesn't accidentally leak to prod.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { mockUpsert } = vi.hoisted(() => ({ mockUpsert: vi.fn() }));

vi.mock("$lib/server/push/push-db", () => ({
  upsertSubscription: mockUpsert,
}));

const { POST } = await import(
  "../../../web/src/routes/api/push/subscribe/+server.js"
);

const gkUser = { id: "u1", tier: "gk" } as const;
const validSub = {
  subscription: {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
    keys: { p256dh: "p256-key", auth: "auth-key" },
  },
};

beforeEach(() => {
  mockUpsert.mockReset();
});

describe("POST /api/push/subscribe", () => {
  it("401 when locals.user is absent", async () => {
    await expect(
      POST(makeEvent({ user: null, body: validSub })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("400 on invalid JSON", async () => {
    await expect(
      POST(makeEvent({ user: gkUser, rawBody: "x" })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when subscription is missing", async () => {
    await expect(
      POST(makeEvent({ user: gkUser, body: {} })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when keys.p256dh is missing", async () => {
    const body = {
      subscription: {
        endpoint: validSub.subscription.endpoint,
        keys: { auth: "auth-key" },
      },
    };
    await expect(
      POST(makeEvent({ user: gkUser, body })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when keys.auth is missing", async () => {
    const body = {
      subscription: {
        endpoint: validSub.subscription.endpoint,
        keys: { p256dh: "p256-key" },
      },
    };
    await expect(
      POST(makeEvent({ user: gkUser, body })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when endpoint is not https", async () => {
    const body = {
      subscription: {
        ...validSub.subscription,
        endpoint: "http://insecure.example/sub",
      },
    };
    await expect(
      POST(makeEvent({ user: gkUser, body })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("200 happy path forwards endpoint, keys, undefined prefs", async () => {
    const res = await POST(makeEvent({ user: gkUser, body: validSub }));
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      "u1",
      "gk",
      validSub.subscription.endpoint,
      "p256-key",
      "auth-key",
      undefined,
    );
  });

  it("200 forwards preferences object when provided", async () => {
    const prefs = { review: true, modmail: false, flag: true, audit: false };
    await POST(
      makeEvent({
        user: gkUser,
        body: { ...validSub, preferences: prefs },
      }),
    );
    expect(mockUpsert).toHaveBeenLastCalledWith(
      "u1",
      "gk",
      validSub.subscription.endpoint,
      "p256-key",
      "auth-key",
      prefs,
    );
  });
});
