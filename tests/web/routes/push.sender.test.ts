// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/push.sender.test.ts
 * WHAT: Unit tests for the push-sender send-time tier gate (#00136).
 * WHY: The subscription tier is a CACHE. The web process cannot re-resolve a
 *      user's current tier at send time (no OAuth token in the event-bus path),
 *      so a stale tier must not be trusted: a subscriber whose tier last
 *      refreshed outside the TTL must be pruned and NOT sent to, while a
 *      still-fresh, still-authorized subscriber must survive the gate.
 *      role:changed must proactively drop subscriptions for a user demoted
 *      below every pushable threshold and re-stamp those still at/above it.
 *
 * Mocking note: web-push lives in web/node_modules and cannot be intercepted by
 * vi.mock from a root-level test (resolution-context mismatch). Instead we mock
 * the resolvable $lib vapid seam with a real valid keypair so ensureVapid()
 * succeeds, and assert the security gate through the (mocked) push-db side
 * effects: which subscriptions get pruned, deleted, or re-stamped.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const STALE_TIER_TTL_SECONDS = 7 * 86400;

// A real, valid VAPID keypair (generated via web-push generateVAPIDKeys) so the
// production setVapidDetails accepts it and ensureVapid() returns true.
const VAPID_PUBLIC =
  "BNXkNsQdXR5ESOISzmqe8yI9EuKJT3ZiRWGPIcwifuo7Pl3FVyIKzsy8I0KCfna3MYB7CfHwbth40i-T6sJ3Ufg";
const VAPID_PRIVATE = "dRE5-i-faoQShvge95jJpS6DdECaaR-2aJPOVzYloh4";

const {
  mockGetSubscriptionsForDomain,
  mockRemoveSubscription,
  mockRemoveAllSubscriptions,
  mockUpdateLastUsed,
  mockUpdateTier,
  mockDeleteStaleSubscriptions,
} = vi.hoisted(() => ({
  mockGetSubscriptionsForDomain: vi.fn(),
  mockRemoveSubscription: vi.fn(),
  mockRemoveAllSubscriptions: vi.fn(),
  mockUpdateLastUsed: vi.fn(),
  mockUpdateTier: vi.fn(),
  mockDeleteStaleSubscriptions: vi.fn(() => 0),
}));

vi.mock("$lib/server/push/vapid", () => ({
  getVapidPublicKey: () => VAPID_PUBLIC,
  getVapidPrivateKey: () => VAPID_PRIVATE,
  getVapidSubject: () => "https://pawtropolis.test",
}));

vi.mock("$lib/server/push/push-db", () => ({
  getSubscriptionsForDomain: mockGetSubscriptionsForDomain,
  removeSubscription: mockRemoveSubscription,
  removeAllSubscriptions: mockRemoveAllSubscriptions,
  updateLastUsed: mockUpdateLastUsed,
  updateTier: mockUpdateTier,
  deleteStaleSubscriptions: mockDeleteStaleSubscriptions,
  STALE_TIER_TTL_SECONDS,
}));

const { pushBroadcast } = await import("$lib/server/push/push-sender");

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function makeSub(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    user_id: "u1",
    tier: "gk",
    endpoint: "https://fcm.googleapis.com/fcm/send/sub-1",
    keys_p256dh: "p256",
    keys_auth: "auth",
    pref_review: 1,
    pref_modmail: 1,
    pref_flag: 1,
    pref_audit: 0,
    created_at: nowSeconds(),
    last_used_at: null,
    tier_updated_at: nowSeconds(),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDeleteStaleSubscriptions.mockReturnValue(0);
});

describe("pushBroadcast send-time tier gate", () => {
  it("prunes a stale-tier subscriber and does not prune a fresh authorized one", () => {
    const staleSub = makeSub({
      endpoint: "https://fcm.googleapis.com/fcm/send/stale",
      tier: "gk",
      // refreshed long before the TTL window -> tier no longer trusted
      tier_updated_at: nowSeconds() - STALE_TIER_TTL_SECONDS - 3600,
    });
    const freshSub = makeSub({
      endpoint: "https://fcm.googleapis.com/fcm/send/fresh",
      tier: "gk",
      tier_updated_at: nowSeconds(),
    });

    mockGetSubscriptionsForDomain.mockReturnValue([staleSub, freshSub]);

    // review:submitted requires min tier "gk"; both cached tiers qualify, but
    // the stale one must be distrusted and pruned rather than trusted.
    pushBroadcast({
      type: "review:submitted",
      payload: { appId: "app-1", applicantName: "Jane Doe" },
      timestamp: Date.now(),
    });

    // Stale subscriber was pruned; fresh authorized subscriber survived the gate.
    expect(mockRemoveSubscription).toHaveBeenCalledWith(staleSub.endpoint);
    expect(mockRemoveSubscription).not.toHaveBeenCalledWith(freshSub.endpoint);
  });

  it("does not prune a fresh subscriber whose cached tier is below the event threshold (it is skipped)", () => {
    // audit:scan_completed requires "admin"; a fresh "mod" is skipped at the
    // tier check, but it is fresh so it must NOT be pruned.
    const lowSub = makeSub({
      endpoint: "https://fcm.googleapis.com/fcm/send/low",
      tier: "mod",
      pref_audit: 1,
      tier_updated_at: nowSeconds(),
    });
    mockGetSubscriptionsForDomain.mockReturnValue([lowSub]);

    pushBroadcast({
      type: "audit:scan_completed",
      payload: { auditType: "avatar", flaggedCount: 2, scannedCount: 10 },
      timestamp: Date.now(),
    });

    expect(mockRemoveSubscription).not.toHaveBeenCalled();
  });

  it("role:changed deletes all subscriptions for a user demoted below every pushable tier", () => {
    // viewer is below gk (the lowest pushable tier: review/modmail gate at gk),
    // so a demotion to viewer can never receive a payload -> drop the rows.
    pushBroadcast({
      type: "role:changed",
      payload: { userId: "u9", newTier: "viewer", previousTier: "gk" },
      timestamp: Date.now(),
    });

    expect(mockRemoveAllSubscriptions).toHaveBeenCalledWith("u9");
    expect(mockUpdateTier).not.toHaveBeenCalled();
  });

  it("role:changed re-stamps (keeps) tier for a gatekeeper, the lowest pushable tier", () => {
    // gk is the floor: gatekeepers legitimately receive review/modmail pushes,
    // so a role:changed affirming gk must NOT purge their subscriptions.
    pushBroadcast({
      type: "role:changed",
      payload: { userId: "u8", newTier: "gk", previousTier: "mod" },
      timestamp: Date.now(),
    });

    expect(mockUpdateTier).toHaveBeenCalledWith("u8", "gk");
    expect(mockRemoveAllSubscriptions).not.toHaveBeenCalled();
  });
});
