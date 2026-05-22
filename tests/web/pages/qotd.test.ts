// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/pages/qotd.test.ts
 * WHAT: Unit tests for dashboard/qotd/+page.server.ts load().
 * WHY: Pins gk gate, the 5-value filter allowlist (unknown -> "all"), q trim
 *      + 100-char cap, and the cursor parse + isFinite gate.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

process.env.GUILD_ID = "g-test";

const { getQotdGrid } = vi.hoisted(() => ({ getQotdGrid: vi.fn() }));

vi.mock("$lib/server/queries/qotd", () => ({ getQotdGrid }));

const { load } = await import(
  "../../../web/src/routes/dashboard/qotd/+page.server.js"
);

function evt(opts: { url?: string; tier?: string } = {}) {
  return makeEvent({
    user: { id: "u1", tier: opts.tier ?? "gk" },
    method: "GET",
    url: opts.url ?? "http://localhost/dashboard/qotd",
  });
}

beforeEach(() => {
  getQotdGrid.mockReset();
  getQotdGrid.mockReturnValue({ items: [], nextCursor: null });
});

describe("dashboard/qotd load()", () => {
  it("403 for viewer (below gk)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(load(evt({ tier: "viewer" }) as any)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("filter passes through when in allowlist (approved)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await load(evt({ url: "http://localhost/?filter=approved" }) as any);
    expect(getQotdGrid).toHaveBeenCalledWith(
      "g-test",
      expect.objectContaining({ filter: "approved" }),
    );
  });

  it("unknown filter falls back to 'all'", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await load(evt({ url: "http://localhost/?filter=junk" }) as any);
    expect(getQotdGrid).toHaveBeenCalledWith(
      "g-test",
      expect.objectContaining({ filter: "all" }),
    );
  });

  it("q trimmed + capped at 100 chars; empty -> undefined", async () => {
    const long = "a".repeat(150);
    await load(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      evt({ url: `http://localhost/?q=%20%20${long}` }) as any,
    );
    expect(getQotdGrid).toHaveBeenLastCalledWith(
      "g-test",
      expect.objectContaining({ search: "a".repeat(100) }),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await load(evt({ url: "http://localhost/?q=" }) as any);
    expect(getQotdGrid).toHaveBeenLastCalledWith(
      "g-test",
      expect.objectContaining({ search: undefined }),
    );
  });

  it("cursor parses int; non-numeric -> undefined", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await load(evt({ url: "http://localhost/?cursor=99" }) as any);
    expect(getQotdGrid).toHaveBeenLastCalledWith(
      "g-test",
      expect.objectContaining({ cursor: 99 }),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await load(evt({ url: "http://localhost/?cursor=NaN" }) as any);
    expect(getQotdGrid).toHaveBeenLastCalledWith(
      "g-test",
      expect.objectContaining({ cursor: undefined }),
    );
  });
});
