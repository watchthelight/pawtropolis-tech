// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect } from "vitest";
import { hintFor } from "../../src/lib/errorHints.js";

describe("hintFor", () => {
  it("returns migration hint for sqlite missing table", () => {
    const err = new Error("no such table: main.application__old");
    err.name = "SqliteError";
    expect(hintFor(err)).toBe("Database schema mismatch. Run migrations or reset safely.");
  });

  it("returns missing permission hint for Discord error code", () => {
    const err = { code: 50013 };
    expect(hintFor(err)).toBe("Missing Discord permission in this channel.");
  });

  it("falls back to default message", () => {
    expect(hintFor(new Error("weird"))).toBe("Unexpected error. Try again or contact staff.");
  });
});
