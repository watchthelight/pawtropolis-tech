// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * tests/features/inventory/capture.test.ts
 * WHAT: The two policy decisions that guard the inventory capture path.
 * WHY: decideSource is what stops a mod's manual grant being swallowed and stops our own
 *      /redeem re-issue looping straight back into inventory. decideDedup is what stops a
 *      reward bot's re-sync inflating a stack on its own. Both are pure, so they are
 *      tested directly rather than through a fake gateway.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../../src/db/db.js", () => ({ db: { prepare: vi.fn() } }));
vi.mock("../../../src/lib/config.js", () => ({ getConfig: vi.fn(() => ({})) }));
vi.mock("../../../src/features/panicStore.js", () => ({ isPanicMode: vi.fn(() => false) }));

import { decideSource } from "../../../src/features/inventory/executor.js";
import {
  decideDedup,
  isSuppressed,
  suppressNextCapture,
  clearSuppression,
  resetSuppression,
} from "../../../src/features/inventory/capture.js";

const SELF = "botself";
const MIMU = "mimu";
const HUMAN = "taylor";

describe("decideSource", () => {
  it("banks a grant from any bot when no allowlist is configured", () => {
    const v = decideSource({ id: MIMU, isBot: true }, SELF, new Set());
    expect(v.ok).toBe(true);
    expect(v.reason).toBe("reward_bot");
  });

  it("REGRESSION: a mod granting the role by hand is left alone", () => {
    const v = decideSource({ id: HUMAN, isBot: false }, SELF, new Set());
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("manual_grant");
  });

  it("REGRESSION: our own re-issue is never captured back", () => {
    const v = decideSource({ id: SELF, isBot: true }, SELF, new Set());
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("self_grant");
  });

  it("fails closed when the audit log entry could not be read", () => {
    const v = decideSource(null, SELF, new Set());
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("unknown_executor");
  });

  it("honours a configured allowlist over the any-bot default", () => {
    const allow = new Set([MIMU]);
    expect(decideSource({ id: MIMU, isBot: true }, SELF, allow).ok).toBe(true);
    expect(decideSource({ id: "amari", isBot: true }, SELF, allow).ok).toBe(false);
  });

  it("keeps blocking our own id even if it appears in the allowlist", () => {
    const v = decideSource({ id: SELF, isBot: true }, SELF, new Set([SELF]));
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("self_grant");
  });
});

describe("decideDedup", () => {
  it("credits a one-shot item the first time its key is seen", () => {
    expect(decideDedup("once_per_key", true, false)).toBe("credit");
  });

  it("REGRESSION: a reward bot re-sync of a one-shot item is absorbed, not stacked", () => {
    expect(decideDedup("once_per_key", false, false)).toBe("absorb");
  });

  it("credits a repeatable item outside the debounce window", () => {
    expect(decideDedup("every_grant", true, false)).toBe("credit");
  });

  it("REGRESSION: a repeat grant inside the debounce window is absorbed", () => {
    expect(decideDedup("every_grant", true, true)).toBe("absorb");
  });

  it("ignores the debounce for one-shot items, since the key already decided it", () => {
    expect(decideDedup("once_per_key", true, true)).toBe("credit");
  });
});

describe("redeem suppression", () => {
  beforeEach(() => {
    resetSuppression();
    vi.useRealTimers();
  });

  it("marks a role we just re-issued so the capture path skips it", () => {
    suppressNextCapture("g", "u", "r");
    expect(isSuppressed("g", "u", "r")).toBe(true);
  });

  it("does not leak across users or roles", () => {
    suppressNextCapture("g", "u", "r");
    expect(isSuppressed("g", "other", "r")).toBe(false);
    expect(isSuppressed("g", "u", "other")).toBe(false);
    expect(isSuppressed("other", "u", "r")).toBe(false);
  });

  it("clears on demand so a refunded redeem does not stay suppressed", () => {
    suppressNextCapture("g", "u", "r");
    clearSuppression("g", "u", "r");
    expect(isSuppressed("g", "u", "r")).toBe(false);
  });

  it("expires after its TTL rather than suppressing a later real grant", () => {
    vi.useFakeTimers();
    suppressNextCapture("g", "u", "r");
    vi.advanceTimersByTime(6 * 60 * 1000);
    expect(isSuppressed("g", "u", "r")).toBe(false);
  });
});
