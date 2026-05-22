// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/pages/modmail.ticketId.test.ts
 * WHAT: Unit tests for dashboard/modmail/[ticketId]/+page.server.ts load().
 * WHY: Three error gates fire in order: 403 (tier < gk), 400 (NaN id), 404
 *      (missing detail). Each pinned.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

process.env.GUILD_ID = "g-test";

const { getModmailThreadDetail } = vi.hoisted(() => ({
  getModmailThreadDetail: vi.fn(),
}));

vi.mock("$lib/server/queries/modmail", () => ({ getModmailThreadDetail }));

const { load } = await import(
  "../../../web/src/routes/dashboard/modmail/[ticketId]/+page.server.js"
);

function evt(opts: { tier?: string; ticketId?: string; user?: unknown } = {}) {
  return makeEvent({
    user: opts.user === undefined ? { id: "u1", tier: opts.tier ?? "gk" } : (opts.user as never),
    method: "GET",
    params: { ticketId: opts.ticketId ?? "42" },
  });
}

beforeEach(() => {
  getModmailThreadDetail.mockReset();
});

describe("dashboard/modmail/[ticketId] load()", () => {
  it("403 for viewer (below gk)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(load(evt({ tier: "viewer" }) as any)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("400 for non-numeric ticketId", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(load(evt({ ticketId: "abc" }) as any)).rejects.toMatchObject({
      status: 400,
    });
  });

  it("404 when detail returns null", async () => {
    getModmailThreadDetail.mockReturnValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(load(evt() as any)).rejects.toMatchObject({ status: 404 });
    expect(getModmailThreadDetail).toHaveBeenCalledWith("g-test", 42);
  });

  it("returns detail object verbatim on hit", async () => {
    const detail = { thread: { id: 42 }, messages: [] };
    getModmailThreadDetail.mockReturnValue(detail);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await load(evt() as any);
    expect(out).toBe(detail);
  });
});
