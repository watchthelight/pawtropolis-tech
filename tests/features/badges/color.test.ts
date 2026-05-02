// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect } from "vitest";
import {
  intToHex,
  normalizeHex,
  readableTextOn,
  relativeLuminance,
  tintForPill,
  accentForRole,
} from "../../../src/features/badges/color.js";

describe("intToHex", () => {
  it("formats a Discord role color", () => {
    expect(intToHex(0x5865f2)).toBe("#5865F2");
  });
  it("returns empty for 0/null/NaN (signals no Discord color)", () => {
    expect(intToHex(0)).toBe("");
    expect(intToHex(undefined)).toBe("");
    expect(intToHex(NaN)).toBe("");
  });
  it("clamps oversized ints", () => {
    expect(intToHex(0xff_ff_ff_00)).toBe("#FFFFFF");
  });
});

describe("normalizeHex", () => {
  it("normalizes case + adds #", () => {
    expect(normalizeHex("aabbcc")).toBe("#AABBCC");
    expect(normalizeHex("#aabbcc")).toBe("#AABBCC");
  });
  it("falls back on invalid input", () => {
    expect(normalizeHex("nope")).toBe("#5865F2");
    expect(normalizeHex("")).toBe("#5865F2");
  });
});

describe("readableTextOn", () => {
  it("picks dark text on bright background", () => {
    expect(readableTextOn("#FFFFFF")).toBe("#0D0D0D");
  });
  it("picks light text on dark background", () => {
    expect(readableTextOn("#000000")).toBe("#FFFFFF");
  });
  it("contrasts above ~3:1 for tinted role pills", () => {
    const pill = tintForPill("#5865F2");
    const text = readableTextOn(pill);
    const lumPill = relativeLuminance(pill);
    const lumText = relativeLuminance(text);
    const ratio = (Math.max(lumPill, lumText) + 0.05) / (Math.min(lumPill, lumText) + 0.05);
    expect(ratio).toBeGreaterThan(3);
  });
});

describe("accentForRole", () => {
  it("returns role color for normal hues", () => {
    expect(accentForRole("#5865F2")).toBe("#5865F2");
  });
  it("brightens very dark roles", () => {
    expect(accentForRole("#000000")).toBe("#B5B7BD");
  });
});

describe("tintForPill", () => {
  it("produces a hex string", () => {
    expect(tintForPill("#5865F2")).toMatch(/^#[0-9A-F]{6}$/);
  });
  it("approaches dark bg as mix decreases", () => {
    const low = tintForPill("#FF0000", 0.0);
    expect(low).toBe("#2B2D31");
  });
});
