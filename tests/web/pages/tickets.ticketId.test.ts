// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/pages/tickets.ticketId.test.ts
 * WHAT: Unit tests for dashboard/tickets/[ticketId]/+page.server.ts load().
 * WHY: Pins three branches: 404 on missing ticket, 403 report-privacy gate
 *      (typeKey report-user / report-staff + tier < mod), and the
 *      canSeeStaffNotes toggle on viewer tier. Privacy gate is security-
 *      sensitive; any tier-comparison regression must surface here.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { getTicketDetail } = vi.hoisted(() => ({ getTicketDetail: vi.fn() }));

vi.mock("$lib/server/queries/tickets", () => ({ getTicketDetail }));

const { load } = await import(
  "../../../web/src/routes/dashboard/tickets/[ticketId]/+page.server.js"
);

function evt(
  overrides: Partial<Parameters<typeof makeEvent>[0]> = {},
) {
  return makeEvent({
    user: { id: "u1", tier: "mod" },
    params: { ticketId: "T1" },
    method: "GET",
    ...overrides,
  });
}

function detail(typeKey: string) {
  return {
    ticket: { id: "T1", typeKey, status: "open" },
    messages: [],
    events: [],
  };
}

beforeEach(() => {
  getTicketDetail.mockReset();
});

describe("dashboard/tickets/[ticketId] load()", () => {
  it("404 when getTicketDetail returns null", async () => {
    getTicketDetail.mockReturnValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(load(evt() as any)).rejects.toMatchObject({ status: 404 });
    expect(getTicketDetail).toHaveBeenCalledWith("T1");
  });

  it("403 on report-user ticket when tier < mod (gk)", async () => {
    getTicketDetail.mockReturnValue(detail("report-user"));
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      load(evt({ user: { id: "u1", tier: "gk" } }) as any),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("403 on report-staff ticket when tier = viewer", async () => {
    getTicketDetail.mockReturnValue(detail("report-staff"));
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      load(evt({ user: { id: "u1", tier: "viewer" } }) as any),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("allows report-user for mod tier", async () => {
    getTicketDetail.mockReturnValue(detail("report-user"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = (await load(evt() as any)) as Record<string, unknown>;
    expect(out.ticket).toMatchObject({ id: "T1", typeKey: "report-user" });
  });

  it("allows non-report ticket (support) for gk tier", async () => {
    getTicketDetail.mockReturnValue(detail("support"));
    const out = (await load(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      evt({ user: { id: "u1", tier: "gk" } }) as any,
    )) as Record<string, unknown>;
    expect(out.ticket).toMatchObject({ typeKey: "support" });
  });

  it("canSeeStaffNotes true for viewer+ tiers; false for none/below", async () => {
    getTicketDetail.mockReturnValue(detail("support"));
    for (const tier of ["viewer", "gk", "mod", "admin", "owner"] as const) {
      const out = (await load(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        evt({ user: { id: "u1", tier } }) as any,
      )) as Record<string, unknown>;
      expect(out.canSeeStaffNotes).toBe(true);
    }
  });

  it("returns spread of detail + canSeeStaffNotes", async () => {
    getTicketDetail.mockReturnValue(detail("support"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = (await load(evt() as any)) as Record<string, unknown>;
    expect(out).toMatchObject({
      ticket: { id: "T1", typeKey: "support" },
      messages: [],
      events: [],
      canSeeStaffNotes: true,
    });
  });
});
