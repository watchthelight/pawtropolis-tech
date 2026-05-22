// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/pages/config.test.ts
 * WHAT: Unit tests for dashboard/config/+page.server.ts load().
 * WHY: Pins admin gate + GUILD_ID env requirement + section/tier passthrough.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

process.env.GUILD_ID = "g-test";

const { getConfigSections } = vi.hoisted(() => ({ getConfigSections: vi.fn() }));

vi.mock("$lib/server/queries/config", () => ({ getConfigSections }));

const { load } = await import(
  "../../../web/src/routes/dashboard/config/+page.server.js"
);

beforeEach(() => {
  getConfigSections.mockReset();
  getConfigSections.mockReturnValue([{ key: "section1" }]);
});

describe("dashboard/config load()", () => {
  it("403 for mod tier", async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      load(makeEvent({ user: { id: "u1", tier: "mod" }, method: "GET" }) as any),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("admin passes; returns sections + userTier", async () => {
    const out = (await load(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeEvent({ user: { id: "u1", tier: "admin" }, method: "GET" }) as any,
    )) as Record<string, unknown>;
    expect(out.sections).toEqual([{ key: "section1" }]);
    expect(out.userTier).toBe("admin");
    expect(getConfigSections).toHaveBeenCalledWith("g-test");
  });
});
