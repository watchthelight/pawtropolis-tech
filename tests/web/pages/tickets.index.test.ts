// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/pages/tickets.index.test.ts
 * WHAT: Unit tests for dashboard/tickets/+page.server.ts load().
 * WHY: Pins the privacy gate (restrictReports = tier < mod), the status
 *      string parser (open|closed|other → undefined), the cursor parse +
 *      isFinite guard, and the typeKey/search passthroughs. Also locks the
 *      shape returned (queries spread + filters + typeKeys + restrictReports).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { listTickets, listTicketTypeKeys } = vi.hoisted(() => ({
  listTickets: vi.fn(),
  listTicketTypeKeys: vi.fn(),
}));

vi.mock("$lib/server/queries/tickets", () => ({
  listTickets,
  listTicketTypeKeys,
}));

const { load } = await import(
  "../../../web/src/routes/dashboard/tickets/+page.server.js"
);

function evt(
  overrides: Partial<Parameters<typeof makeEvent>[0]> = {},
) {
  return makeEvent({
    user: { id: "u1", tier: "mod" },
    method: "GET",
    url: "http://localhost/dashboard/tickets",
    ...overrides,
  });
}

beforeEach(() => {
  listTickets.mockReset();
  listTicketTypeKeys.mockReset();
  listTickets.mockReturnValue({ tickets: [], nextCursor: null });
  listTicketTypeKeys.mockReturnValue(["report-user", "support"]);
});

describe("dashboard/tickets load()", () => {
  it("restrictReports = false for mod tier; true for viewer", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let out = (await load(evt() as any)) as Record<string, unknown>;
    expect(out.restrictReports).toBe(false);
    expect(listTickets).toHaveBeenLastCalledWith(
      expect.objectContaining({ restrictReports: false }),
    );
    expect(listTicketTypeKeys).toHaveBeenLastCalledWith(false);

    out = (await load(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      evt({ user: { id: "u1", tier: "viewer" } }) as any,
    )) as Record<string, unknown>;
    expect(out.restrictReports).toBe(true);
    expect(listTickets).toHaveBeenLastCalledWith(
      expect.objectContaining({ restrictReports: true }),
    );
    expect(listTicketTypeKeys).toHaveBeenLastCalledWith(true);
  });

  it("status parses open / closed only; other values fall to undefined", async () => {
    await load(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      evt({ url: "http://localhost/?status=open" }) as any,
    );
    expect(listTickets).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "open" }),
    );

    await load(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      evt({ url: "http://localhost/?status=closed" }) as any,
    );
    expect(listTickets).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "closed" }),
    );

    for (const bad of ["junk", "OPEN", ""]) {
      await load(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        evt({ url: `http://localhost/?status=${bad}` }) as any,
      );
      expect(listTickets).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: undefined }),
      );
    }
  });

  it("cursor parses to int; non-finite (NaN) becomes undefined", async () => {
    await load(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      evt({ url: "http://localhost/?cursor=42" }) as any,
    );
    expect(listTickets).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 42 }),
    );

    await load(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      evt({ url: "http://localhost/?cursor=abc" }) as any,
    );
    expect(listTickets).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: undefined }),
    );
  });

  it("passes through typeKey and search; absent params become undefined", async () => {
    await load(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      evt({ url: "http://localhost/?type=report-user&search=alice" }) as any,
    );
    expect(listTickets).toHaveBeenLastCalledWith(
      expect.objectContaining({ typeKey: "report-user", search: "alice" }),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await load(evt() as any);
    expect(listTickets).toHaveBeenLastCalledWith(
      expect.objectContaining({ typeKey: undefined, search: undefined }),
    );
  });

  it("returns spread of query result + filters + typeKeys + restrictReports", async () => {
    listTickets.mockReturnValue({ tickets: [{ id: "T1" }], nextCursor: 99 });
    listTicketTypeKeys.mockReturnValue(["bug", "support"]);

    const out = (await load(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      evt({ url: "http://localhost/?type=bug&status=open&search=hi" }) as any,
    )) as Record<string, unknown>;

    expect(out.tickets).toEqual([{ id: "T1" }]);
    expect(out.nextCursor).toBe(99);
    expect(out.typeKeys).toEqual(["bug", "support"]);
    expect(out.filters).toEqual({
      typeKey: "bug",
      status: "open",
      search: "hi",
    });
    expect(out.restrictReports).toBe(false);
  });
});
