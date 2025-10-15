/**
 * Pawtropolis Tech Gatekeeper - Tests
 * Copyright (c) 2025 watchthelight (Bash) <admin@watchthelight.org>
 * License: MIT
 */

import { describe, it, expect } from "vitest";
import { Snowflake, Hours, HttpUrl, ConfigKey } from "../src/lib/validators.js";

describe("Validators", () => {
  describe("Snowflake", () => {
    it("should accept valid Discord snowflakes", () => {
      expect(() => Snowflake.parse("123456789012345678")).not.toThrow();
      expect(() => Snowflake.parse("1427677679280324730")).not.toThrow();
    });

    it("should reject invalid snowflakes", () => {
      expect(() => Snowflake.parse("123")).toThrow();
      expect(() => Snowflake.parse("abc")).toThrow();
      expect(() => Snowflake.parse("")).toThrow();
      expect(() => Snowflake.parse("12345678901234567890123")).toThrow();
    });
  });

  describe("Hours", () => {
    it("should accept valid hour values", () => {
      expect(Hours.parse("0")).toBe(0);
      expect(Hours.parse("24")).toBe(24);
      expect(Hours.parse("168")).toBe(168);
      expect(Hours.parse(24)).toBe(24);
    });

    it("should reject negative hours", () => {
      expect(() => Hours.parse("-1")).toThrow();
      expect(() => Hours.parse(-5)).toThrow();
    });

    it("should reject non-integer hours", () => {
      expect(() => Hours.parse("12.5")).toThrow();
      expect(() => Hours.parse(24.7)).toThrow();
    });
  });

  describe("HttpUrl", () => {
    it("should accept valid HTTP(S) URLs", () => {
      expect(() => HttpUrl.parse("https://example.com")).not.toThrow();
      expect(() => HttpUrl.parse("http://example.com/path?query=value")).not.toThrow();
      expect(() =>
        HttpUrl.parse("https://lens.google.com/uploadbyurl?url={avatarUrl}")
      ).not.toThrow();
    });

    it("should reject non-HTTP URLs", () => {
      expect(() => HttpUrl.parse("ftp://example.com")).toThrow();
      expect(() => HttpUrl.parse("file:///path/to/file")).toThrow();
      expect(() => HttpUrl.parse("not-a-url")).toThrow();
    });
  });

  describe("ConfigKey", () => {
    it("should accept valid config keys", () => {
      expect(() => ConfigKey.parse("review_channel_id")).not.toThrow();
      expect(() => ConfigKey.parse("reapply_cooldown_hours")).not.toThrow();
      expect(() => ConfigKey.parse("image_search_url_template")).not.toThrow();
    });

    it("should reject invalid config keys", () => {
      expect(() => ConfigKey.parse("invalid_key")).toThrow();
      expect(() => ConfigKey.parse("")).toThrow();
    });

    it("should have all expected config keys", () => {
      const expectedKeys = [
        "review_channel_id",
        "gate_channel_id",
        "unverified_channel_id",
        "general_channel_id",
        "accepted_role_id",
        "reviewer_role_id",
        "reapply_cooldown_hours",
        "min_account_age_hours",
        "min_join_age_hours",
        "image_search_url_template",
      ];

      expectedKeys.forEach((key) => {
        expect(() => ConfigKey.parse(key)).not.toThrow();
      });
    });
  });
});
