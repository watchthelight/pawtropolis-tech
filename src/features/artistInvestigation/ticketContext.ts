/**
 * Pawtropolis Tech -- src/features/artistInvestigation/ticketContext.ts
 * WHAT: Decides whether a channel is a 2D artist verification ticket and who opened it.
 * WHY: Two ticket systems are in play. First-party tickets have a row in `ticket`.
 *      The live server still uses Ticket Tool, which leaves no row: those channels
 *      are recognized by category and name, and the opener comes from the greeting.
 *      Both functions are pure so the rules can be tested without Discord.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { ARTIST_TICKET_NAME_PREFIX, ARTIST_TICKET_TYPE_KEY } from "./config.js";

export interface ChannelFacts {
  name: string;
  parentId: string | null;
  /** A normal guild text channel. Threads, forums and voice channels are never tickets. */
  isGuildText: boolean;
}

export interface TicketRowFacts {
  typeKey: string;
  openerUserId: string;
  status: string;
  legacySource: string | null;
}

export type TicketCheck =
  | { ok: true; system: "first-party" | "ticket-tool"; openerId: string | null; closed: boolean }
  | { ok: false; reason: string };

const NOT_A_TICKET = "This only works inside a 2D artist verification ticket channel.";

export function classifyTicketChannel(
  channel: ChannelFacts,
  ticket: TicketRowFacts | null,
  ticketsCategoryId: string | null
): TicketCheck {
  if (!channel.isGuildText) return { ok: false, reason: NOT_A_TICKET };

  if (ticket && !ticket.legacySource) {
    if (ticket.typeKey !== ARTIST_TICKET_TYPE_KEY) {
      return {
        ok: false,
        reason: `This is a \`${ticket.typeKey}\` ticket. The command only works in 2D artist verification tickets.`,
      };
    }
    return {
      ok: true,
      system: "first-party",
      openerId: ticket.openerUserId,
      closed: ticket.status === "closed",
    };
  }

  const name = channel.name.toLowerCase();
  const inTicketsCategory = ticketsCategoryId !== null && channel.parentId === ticketsCategoryId;
  if (inTicketsCategory && name.startsWith(ARTIST_TICKET_NAME_PREFIX)) {
    return {
      ok: true,
      system: "ticket-tool",
      openerId: null,
      closed: name.startsWith(`${ARTIST_TICKET_NAME_PREFIX}closed`),
    };
  }

  return { ok: false, reason: NOT_A_TICKET };
}

export interface ApplicantInputs {
  /** The `applicant` option, when the owner supplied one. */
  overrideUserId: string | null;
  /** Opener recorded on a first-party ticket row. */
  ticketOpenerId: string | null;
  /** Text of the first bot message in the channel (the ticket greeting). */
  greetingContent: string | null;
  /** Users with their own permission overwrite on the channel. */
  memberOverwriteIds: string[];
  /** Bots that also hold member overwrites: Ticket Tool and this bot. */
  excludeIds: string[];
}

export type ApplicantResolution =
  | { ok: true; userId: string; via: "option" | "ticket" | "greeting" | "overwrite" }
  | { ok: false; reason: string };

const GREETING_MENTION = /Hello <@!?(\d{16,20})>/;

export function resolveApplicant(input: ApplicantInputs): ApplicantResolution {
  if (input.overrideUserId) return { ok: true, userId: input.overrideUserId, via: "option" };
  if (input.ticketOpenerId) return { ok: true, userId: input.ticketOpenerId, via: "ticket" };

  const greeted = input.greetingContent?.match(GREETING_MENTION)?.[1];
  if (greeted) return { ok: true, userId: greeted, via: "greeting" };

  const candidates = input.memberOverwriteIds.filter((id) => !input.excludeIds.includes(id));
  const [only] = candidates;
  if (candidates.length === 1 && only) return { ok: true, userId: only, via: "overwrite" };

  return {
    ok: false,
    reason:
      candidates.length > 1
        ? "More than one member has access to this ticket and the greeting does not name the opener. Run it again with the `applicant` option."
        : "Could not tell who opened this ticket. Run it again with the `applicant` option.",
  };
}
