// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/features/artistInvestigation/ticketContext.test.ts
 * WHAT: The ticket-channel check and the "who is the applicant" rules.
 * WHY: /investigate-artist must refuse to run anywhere but a 2D artist
 *      verification ticket, and must never guess the applicant when the channel
 *      does not say who opened it.
 */
import { describe, expect, it } from "vitest";
import {
  classifyTicketChannel,
  resolveApplicant,
  type ApplicantInputs,
  type TicketRowFacts,
} from "../../../src/features/artistInvestigation/ticketContext.js";

const TICKETS_CATEGORY = "900000000000000001";
const NOT_A_TICKET = "This only works inside a 2D artist verification ticket channel.";

const row = (overrides: Partial<TicketRowFacts> = {}): TicketRowFacts => ({
  typeKey: "2d-artist",
  openerUserId: "400000000000000001",
  status: "open",
  legacySource: null,
  ...overrides,
});

describe("classifyTicketChannel", () => {
  it("accepts a first-party 2D artist ticket and reports its opener", () => {
    const check = classifyTicketChannel({ name: "2d-artist-0007", parentId: null, isGuildText: true }, row(), null);
    expect(check).toEqual({ ok: true, system: "first-party", openerId: "400000000000000001", closed: false });
  });

  it("marks a first-party ticket closed from its row, not from its name", () => {
    const check = classifyTicketChannel(
      { name: "2d-artist-0007", parentId: null, isGuildText: true },
      row({ status: "closed" }),
      null
    );
    expect(check).toMatchObject({ ok: true, closed: true });
  });

  it("refuses a first-party ticket of another type and names the type", () => {
    const check = classifyTicketChannel(
      { name: "support-0003", parentId: TICKETS_CATEGORY, isGuildText: true },
      row({ typeKey: "support" }),
      TICKETS_CATEGORY
    );
    expect(check.ok).toBe(false);
    expect(check).toMatchObject({ reason: expect.stringContaining("`support` ticket") });
  });

  it("does not let another ticket type pass through its channel name", () => {
    // The row wins: a support ticket renamed to look like an artist ticket is still a support ticket.
    const check = classifyTicketChannel(
      { name: "2d-artist-0003", parentId: TICKETS_CATEGORY, isGuildText: true },
      row({ typeKey: "support" }),
      TICKETS_CATEGORY
    );
    expect(check.ok).toBe(false);
  });

  it("accepts a Ticket Tool channel by category and name, with no opener", () => {
    const check = classifyTicketChannel(
      { name: "2d-artist-0142", parentId: TICKETS_CATEGORY, isGuildText: true },
      null,
      TICKETS_CATEGORY
    );
    expect(check).toEqual({ ok: true, system: "ticket-tool", openerId: null, closed: false });
  });

  it("reads a closed Ticket Tool ticket from its renamed channel", () => {
    const check = classifyTicketChannel(
      { name: "2D-Artist-Closed0142", parentId: TICKETS_CATEGORY, isGuildText: true },
      null,
      TICKETS_CATEGORY
    );
    expect(check).toEqual({ ok: true, system: "ticket-tool", openerId: null, closed: true });
  });

  it("treats an imported legacy row as a Ticket Tool channel", () => {
    const check = classifyTicketChannel(
      { name: "2d-artist-0142", parentId: TICKETS_CATEGORY, isGuildText: true },
      row({ legacySource: "ticket-tool" }),
      TICKETS_CATEGORY
    );
    expect(check).toMatchObject({ ok: true, system: "ticket-tool", openerId: null });
  });

  it.each([
    ["a channel with the right name outside the tickets category", { name: "2d-artist-0142", parentId: "900000000000000002", isGuildText: true }],
    ["a channel with the right name and no category", { name: "2d-artist-0142", parentId: null, isGuildText: true }],
    ["another ticket type inside the tickets category", { name: "support-0142", parentId: TICKETS_CATEGORY, isGuildText: true }],
    ["a general chat channel", { name: "general", parentId: "900000000000000002", isGuildText: true }],
    ["a thread or forum post", { name: "2d-artist-0142", parentId: TICKETS_CATEGORY, isGuildText: false }],
  ])("refuses %s", (_label, channel) => {
    expect(classifyTicketChannel(channel, null, TICKETS_CATEGORY)).toEqual({ ok: false, reason: NOT_A_TICKET });
  });

  it("refuses name-matched channels when no tickets category is configured", () => {
    const check = classifyTicketChannel({ name: "2d-artist-0142", parentId: null, isGuildText: true }, null, null);
    expect(check).toEqual({ ok: false, reason: NOT_A_TICKET });
  });

  it("refuses a first-party artist ticket that is not a text channel", () => {
    const check = classifyTicketChannel({ name: "2d-artist-0007", parentId: null, isGuildText: false }, row(), null);
    expect(check).toEqual({ ok: false, reason: NOT_A_TICKET });
  });
});

describe("resolveApplicant", () => {
  const inputs = (overrides: Partial<ApplicantInputs> = {}): ApplicantInputs => ({
    overrideUserId: null,
    ticketOpenerId: null,
    greetingContent: null,
    memberOverwriteIds: [],
    excludeIds: ["557628352828014614", "400000000000000009"],
    ...overrides,
  });

  it("prefers the owner's option over everything else", () => {
    const who = resolveApplicant(
      inputs({
        overrideUserId: "111111111111111111",
        ticketOpenerId: "222222222222222222",
        greetingContent: "Hello <@333333333333333333>!",
      })
    );
    expect(who).toEqual({ ok: true, userId: "111111111111111111", via: "option" });
  });

  it("uses the ticket row's opener next", () => {
    const who = resolveApplicant(inputs({ ticketOpenerId: "222222222222222222", greetingContent: "Hello <@333333333333333333>!" }));
    expect(who).toEqual({ ok: true, userId: "222222222222222222", via: "ticket" });
  });

  it("reads the opener from the Ticket Tool greeting", () => {
    const who = resolveApplicant(
      inputs({ greetingContent: "Hello <@333333333333333333>! A <@&444444444444444444> has been notified" })
    );
    expect(who).toEqual({ ok: true, userId: "333333333333333333", via: "greeting" });
  });

  it("reads a nickname-style mention in the greeting", () => {
    const who = resolveApplicant(inputs({ greetingContent: "Hello <@!333333333333333333>!" }));
    expect(who).toMatchObject({ ok: true, userId: "333333333333333333" });
  });

  it("does not take a role mention for the opener", () => {
    const who = resolveApplicant(inputs({ greetingContent: "Hello <@&444444444444444444>!" }));
    expect(who.ok).toBe(false);
  });

  it("falls back to the only member with a permission overwrite, ignoring the bots", () => {
    const who = resolveApplicant(
      inputs({ memberOverwriteIds: ["557628352828014614", "400000000000000009", "555555555555555555"] })
    );
    expect(who).toEqual({ ok: true, userId: "555555555555555555", via: "overwrite" });
  });

  it("asks for the option when several members have access", () => {
    const who = resolveApplicant(inputs({ memberOverwriteIds: ["555555555555555555", "666666666666666666"] }));
    expect(who).toMatchObject({ ok: false, reason: expect.stringContaining("More than one member") });
    expect(who).toMatchObject({ reason: expect.stringContaining("`applicant` option") });
  });

  it("asks for the option when nothing identifies the opener", () => {
    const who = resolveApplicant(inputs({ greetingContent: "Welcome!", memberOverwriteIds: ["557628352828014614"] }));
    expect(who).toMatchObject({ ok: false, reason: expect.stringContaining("Could not tell who opened this ticket") });
  });
});
