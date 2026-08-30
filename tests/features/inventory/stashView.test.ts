// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * tests/features/inventory/stashView.test.ts
 * WHAT: What /stash shows while a capture is still inside its grace window.
 * WHY: Taylor earned a Byte Token [Rare] from Mimu and ran /stash inside the 60s window.
 *      The ledger was still empty, so the embed said nothing was stored and the reward
 *      looked lost. The view is pure, so the copy is asserted directly.
 */
import { describe, it, expect } from "vitest";

import { buildStashView, EMPTY_SELF } from "../../../src/features/inventory/stashView.js";

const NOW = 1_700_000_000;
const display = (key: string) =>
  key === "byte:rare" ? "Byte Token [Rare]" : key === "art:sketch" ? "Sketch Ticket" : key;

describe("buildStashView", () => {
  it("REGRESSION: shows an item still inside its grace window instead of the empty state", () => {
    const view = buildStashView(
      [],
      [{ itemKey: "byte:rare", removeAtS: NOW + 45 }],
      display,
      true,
      "taylor",
      NOW
    );

    expect(view.description).not.toBe(EMPTY_SELF);
    expect(view.description).toContain("Byte Token [Rare]");
    expect(view.description).toContain("in 45s");
  });

  it("REGRESSION: lists in-flight items alongside stacks already banked", () => {
    const view = buildStashView(
      [{ itemKey: "art:sketch", quantity: 2 }],
      [{ itemKey: "byte:rare", removeAtS: NOW + 30 }],
      display,
      true,
      "taylor",
      NOW
    );

    expect(view.description).toContain("**x2** Sketch Ticket");
    expect(view.description).toContain("Byte Token [Rare]");
    expect(view.footer).toContain("2 items across 1 stack");
  });

  it("keeps the empty state when nothing is held and nothing is queued", () => {
    const view = buildStashView([], [], display, true, "taylor", NOW);

    expect(view.description).toBe(EMPTY_SELF);
    expect(view.footer).toBeNull();
  });

  it("keeps the third party empty state for a staff view", () => {
    const view = buildStashView([], [], display, false, "taylor", NOW);

    expect(view.description).toBe("<@taylor> is not holding any reward items.");
  });

  it("renders a settled stash exactly as before", () => {
    const view = buildStashView(
      [
        { itemKey: "byte:rare", quantity: 3 },
        { itemKey: "art:sketch", quantity: 1 },
      ],
      [],
      display,
      true,
      "taylor",
      NOW
    );

    expect(view.description).toBe("**x3** Byte Token [Rare]\n**x1** Sketch Ticket");
    expect(view.footer).toBe("4 items across 2 stacks | /redeem to cash one in");
  });

  it("says any moment now once the window has already expired", () => {
    const view = buildStashView(
      [],
      [{ itemKey: "byte:rare", removeAtS: NOW - 5 }],
      display,
      true,
      "taylor",
      NOW
    );

    expect(view.description).toContain("any moment now");
  });

  it("switches to minutes for a long grace window", () => {
    const view = buildStashView(
      [],
      [{ itemKey: "byte:rare", removeAtS: NOW + 300 }],
      display,
      true,
      "taylor",
      NOW
    );

    expect(view.description).toContain("in 5m");
  });
});
