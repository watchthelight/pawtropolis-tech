// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/features/inventory/stashView.ts
 * WHAT: Builds the body of the /stash embed from settled stacks plus in-flight captures.
 * WHY: A captured role sits in pending_item_capture for the whole grace window. Reading
 *      only the ledger meant a member who checked /stash straight after earning an item
 *      was told nothing was stored, which reads as the reward never having registered.
 *
 * Pure on purpose: no discord.js, no database, so the copy is testable directly.
 */

export interface HeldStack {
  itemKey: string;
  quantity: number;
}

export interface InFlightItem {
  itemKey: string;
  removeAtS: number;
}

export interface StashView {
  description: string;
  footer: string | null;
}

export const EMPTY_SELF =
  "Nothing stored yet. Reward items land here automatically when you earn them.";

function landingIn(removeAtS: number, nowS: number): string {
  const remaining = removeAtS - nowS;
  if (remaining <= 0) return "any moment now";
  if (remaining < 60) return `in ${remaining}s`;
  return `in ${Math.ceil(remaining / 60)}m`;
}

/**
 * @param displayFor - resolves an item key to its catalog display name
 * @param isSelf     - whether the viewer is looking at their own stash
 */
export function buildStashView(
  held: HeldStack[],
  inFlight: InFlightItem[],
  displayFor: (itemKey: string) => string,
  isSelf: boolean,
  targetId: string,
  nowS: number
): StashView {
  const sections: string[] = [];

  if (held.length > 0) {
    sections.push(held.map((r) => `**x${r.quantity}** ${displayFor(r.itemKey)}`).join("\n"));
  }

  if (inFlight.length > 0) {
    const lines = inFlight.map(
      (p) => `${displayFor(p.itemKey)} ${landingIn(p.removeAtS, nowS)}`
    );
    sections.push(`*Landing shortly:*\n${lines.join("\n")}`);
  }

  if (sections.length === 0) {
    return {
      description: isSelf ? EMPTY_SELF : `<@${targetId}> is not holding any reward items.`,
      footer: null,
    };
  }

  if (held.length === 0) {
    return {
      description: sections.join("\n\n"),
      footer: "Reward bots get a moment to finish before an item is banked",
    };
  }

  const total = held.reduce((sum, r) => sum + r.quantity, 0);
  return {
    description: sections.join("\n\n"),
    footer:
      `${total} item${total === 1 ? "" : "s"} across ${held.length} stack${held.length === 1 ? "" : "s"}` +
      " | /redeem to cash one in",
  };
}
