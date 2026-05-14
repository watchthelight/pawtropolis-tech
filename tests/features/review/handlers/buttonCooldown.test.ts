/**
 * Pawtropolis Tech -- tests/features/review/handlers/buttonCooldown.test.ts
 * WHAT: Regression tests for the per-action review-button rate limiter.
 * WHY: A prior per-app key swallowed sequential different button clicks on the
 *      same review card (claim -> wrong_password), so the first wrong_password
 *      click appeared to do nothing until the cooldown expired.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, beforeEach } from "vitest";
import {
  BUTTON_COOLDOWN_MS,
  cooldownKeyFor,
  isRateLimited,
  recordClick,
  pruneStaleCooldowns,
  _resetCooldownsForTest,
  _sizeForTest,
} from "../../../../src/features/review/handlers/buttonCooldown.js";

const USER = "111111111111111111";
const CODE = "ABCDEF";

describe("buttonCooldown", () => {
  beforeEach(() => {
    _resetCooldownsForTest();
  });

  describe("cooldownKeyFor", () => {
    it("includes user, app code, and action", () => {
      expect(cooldownKeyFor(USER, CODE, "wrong_password")).toBe(
        `${USER}:${CODE}:wrong_password`,
      );
    });

    it("produces distinct keys for different actions on the same app", () => {
      const claimKey = cooldownKeyFor(USER, CODE, "claim");
      const wrongPwKey = cooldownKeyFor(USER, CODE, "wrong_password");
      expect(claimKey).not.toBe(wrongPwKey);
    });

    it("produces distinct keys for different apps with the same action", () => {
      expect(cooldownKeyFor(USER, "AAAAAA", "claim")).not.toBe(
        cooldownKeyFor(USER, "BBBBBB", "claim"),
      );
    });

    it("produces distinct keys for different users on the same button", () => {
      expect(cooldownKeyFor("u1", CODE, "claim")).not.toBe(
        cooldownKeyFor("u2", CODE, "claim"),
      );
    });
  });

  describe("isRateLimited / recordClick", () => {
    it("returns false when no prior click recorded", () => {
      const key = cooldownKeyFor(USER, CODE, "wrong_password");
      expect(isRateLimited(key)).toBe(false);
    });

    it("returns true within the cooldown window after a recorded click", () => {
      const key = cooldownKeyFor(USER, CODE, "wrong_password");
      const t0 = 1_000_000;
      recordClick(key, t0);
      expect(isRateLimited(key, t0 + BUTTON_COOLDOWN_MS - 1)).toBe(true);
    });

    it("returns false once the cooldown window has elapsed", () => {
      const key = cooldownKeyFor(USER, CODE, "wrong_password");
      const t0 = 1_000_000;
      recordClick(key, t0);
      expect(isRateLimited(key, t0 + BUTTON_COOLDOWN_MS)).toBe(false);
      expect(isRateLimited(key, t0 + BUTTON_COOLDOWN_MS + 1)).toBe(false);
    });

    it("rate-limits a duplicate click on the SAME button within the window", () => {
      const key = cooldownKeyFor(USER, CODE, "wrong_password");
      const t0 = 5_000_000;
      recordClick(key, t0);
      // Second click 500ms later on the same button: should be rate-limited.
      expect(isRateLimited(key, t0 + 500)).toBe(true);
    });

    it("REGRESSION: does NOT rate-limit a DIFFERENT action on the same app within the window", () => {
      // Staff clicks Claim, which sets a cooldown. The card re-renders with
      // additional buttons (incl. Wrong Password) that only appear after claim.
      // The follow-up Wrong Password click must NOT be silently swallowed.
      const t0 = 5_000_000;
      const claimKey = cooldownKeyFor(USER, CODE, "claim");
      recordClick(claimKey, t0);

      const wrongPwKey = cooldownKeyFor(USER, CODE, "wrong_password");
      // 200ms after claim — well inside the 3s window of the OLD per-app key.
      expect(isRateLimited(wrongPwKey, t0 + 200)).toBe(false);
    });

    it("REGRESSION: sequential decisive actions (reject -> kick) are independent", () => {
      const t0 = 9_000_000;
      recordClick(cooldownKeyFor(USER, CODE, "reject"), t0);
      expect(isRateLimited(cooldownKeyFor(USER, CODE, "kick"), t0 + 100)).toBe(false);
    });
  });

  describe("pruneStaleCooldowns", () => {
    it("removes entries older than 2x the cooldown window", () => {
      const key = cooldownKeyFor(USER, CODE, "claim");
      const t0 = 0;
      recordClick(key, t0);
      expect(_sizeForTest()).toBe(1);

      pruneStaleCooldowns(t0 + BUTTON_COOLDOWN_MS * 2 + 1);
      expect(_sizeForTest()).toBe(0);
    });

    it("keeps entries still inside the retention window", () => {
      const key = cooldownKeyFor(USER, CODE, "claim");
      const t0 = 0;
      recordClick(key, t0);

      pruneStaleCooldowns(t0 + BUTTON_COOLDOWN_MS); // 1x window — still fresh
      expect(_sizeForTest()).toBe(1);
    });
  });
});
