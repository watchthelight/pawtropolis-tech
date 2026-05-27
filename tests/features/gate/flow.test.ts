/**
 * Pawtropolis Tech -- tests/features/gate/flow.test.ts
 * WHAT: Unit tests for the application lifecycle state machine (gate/flow.ts).
 * WHY: The flow used to live as bare string literals inside the Discord
 *      handlers, untestable without a mocked interaction. flow.ts is pure, so
 *      these transitions and classifications are verified directly. (#00011.)
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect } from "vitest";
import {
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  GATE_TRANSITIONS,
  type ApplicationStatus,
  isDraft,
  isSubmitted,
  isActiveStatus,
  isTerminalStatus,
  canTransition,
  classifyDraftStatus,
} from "../../../src/features/gate/flow.js";

const ALL_STATUSES: ApplicationStatus[] = [
  "draft",
  "submitted",
  "needs_info",
  "approved",
  "rejected",
  "kicked",
];

describe("gate/flow status sets", () => {
  it("active statuses are submitted and needs_info", () => {
    expect([...ACTIVE_STATUSES]).toEqual(["submitted", "needs_info"]);
  });

  it("terminal statuses are approved, rejected, kicked", () => {
    expect([...TERMINAL_STATUSES]).toEqual(["approved", "rejected", "kicked"]);
  });

  it("active and terminal sets are disjoint", () => {
    const overlap = ACTIVE_STATUSES.filter((s) =>
      (TERMINAL_STATUSES as readonly string[]).includes(s)
    );
    expect(overlap).toHaveLength(0);
  });

  it("draft is neither active nor terminal", () => {
    expect(isActiveStatus("draft")).toBe(false);
    expect(isTerminalStatus("draft")).toBe(false);
  });
});

describe("gate/flow predicates", () => {
  it("isDraft only matches draft", () => {
    expect(isDraft("draft")).toBe(true);
    for (const s of ALL_STATUSES.filter((x) => x !== "draft")) {
      expect(isDraft(s)).toBe(false);
    }
  });

  it("isSubmitted only matches submitted", () => {
    expect(isSubmitted("submitted")).toBe(true);
    for (const s of ALL_STATUSES.filter((x) => x !== "submitted")) {
      expect(isSubmitted(s)).toBe(false);
    }
  });

  it("isActiveStatus matches submitted and needs_info", () => {
    expect(isActiveStatus("submitted")).toBe(true);
    expect(isActiveStatus("needs_info")).toBe(true);
    expect(isActiveStatus("approved")).toBe(false);
  });

  it("isTerminalStatus matches approved, rejected, kicked", () => {
    expect(isTerminalStatus("approved")).toBe(true);
    expect(isTerminalStatus("rejected")).toBe(true);
    expect(isTerminalStatus("kicked")).toBe(true);
    expect(isTerminalStatus("submitted")).toBe(false);
  });

  it("predicates reject unknown statuses", () => {
    expect(isDraft("garbage")).toBe(false);
    expect(isSubmitted("garbage")).toBe(false);
    expect(isActiveStatus("garbage")).toBe(false);
    expect(isTerminalStatus("garbage")).toBe(false);
  });
});

describe("gate/flow transitions", () => {
  it("the gate drives draft -> submitted", () => {
    expect(canTransition("draft", "submitted")).toBe(true);
  });

  it("a draft cannot jump straight to a terminal status", () => {
    expect(canTransition("draft", "approved")).toBe(false);
    expect(canTransition("draft", "rejected")).toBe(false);
    expect(canTransition("draft", "kicked")).toBe(false);
    expect(canTransition("draft", "needs_info")).toBe(false);
  });

  it("submitted can move to review outcomes", () => {
    expect(canTransition("submitted", "needs_info")).toBe(true);
    expect(canTransition("submitted", "approved")).toBe(true);
    expect(canTransition("submitted", "rejected")).toBe(true);
    expect(canTransition("submitted", "kicked")).toBe(true);
  });

  it("needs_info can loop back to submitted on resubmission", () => {
    expect(canTransition("needs_info", "submitted")).toBe(true);
  });

  it("terminal statuses have no outgoing transitions", () => {
    for (const terminal of TERMINAL_STATUSES) {
      expect(GATE_TRANSITIONS[terminal]).toHaveLength(0);
      for (const to of ALL_STATUSES) {
        expect(canTransition(terminal, to)).toBe(false);
      }
    }
  });

  it("no status transitions to itself", () => {
    for (const s of ALL_STATUSES) {
      expect(canTransition(s, s)).toBe(false);
    }
  });

  it("rejects transitions from an unknown source", () => {
    expect(canTransition("garbage", "submitted")).toBe(false);
  });

  it("transition targets are all valid statuses", () => {
    for (const targets of Object.values(GATE_TRANSITIONS)) {
      for (const to of targets) {
        expect(ALL_STATUSES).toContain(to);
      }
    }
  });
});

describe("gate/flow classifyDraftStatus", () => {
  it("submitted -> submitted (show done confirmation)", () => {
    expect(classifyDraftStatus("submitted")).toBe("submitted");
  });

  it("draft -> open (safe to persist / submit)", () => {
    expect(classifyDraftStatus("draft")).toBe("open");
  });

  it("terminal and unexpected statuses -> closed", () => {
    expect(classifyDraftStatus("approved")).toBe("closed");
    expect(classifyDraftStatus("rejected")).toBe("closed");
    expect(classifyDraftStatus("kicked")).toBe("closed");
    expect(classifyDraftStatus("needs_info")).toBe("closed");
    expect(classifyDraftStatus("garbage")).toBe("closed");
  });
});
