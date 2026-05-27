/**
 * Pawtropolis Tech -- src/features/gate/flow.ts
 * WHAT: The application lifecycle as an explicit state machine: the canonical
 *       status type, status-set classification, and the allowed transitions.
 * WHY: Status checks were scattered as bare string literals across handlers.ts
 *       and drafts.ts ("submitted", "draft", IN ('submitted','needs_info')).
 *       Centralizing them makes the gate flow legible and testable without a
 *       live Discord interaction. This module is pure: no discord.js, no db.
 *       (#00011 slice 1.)
 *
 * THE FLOW (applicant-facing portion the gate drives):
 *   (none) --getOrCreateDraft--> draft --submitApplication--> submitted
 *   Staff review (review.ts) then drives submitted -> needs_info / approved /
 *   rejected / kicked. needs_info loops back to submitted on resubmission.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

/** Every status an application row may hold (DB `application.status`). */
export type ApplicationStatus =
  | "draft"
  | "submitted"
  | "needs_info"
  | "approved"
  | "rejected"
  | "kicked";

/**
 * In-flight statuses: an application here blocks the user from starting a fresh
 * draft. Mirrors the `status IN ('submitted','needs_info')` guard in
 * getOrCreateDraft.
 */
export const ACTIVE_STATUSES = ["submitted", "needs_info"] as const;

/**
 * Terminal statuses: review has concluded. These are the only rows eligible for
 * shortCode-reuse cleanup. Mirrors the `status IN ('approved','rejected','kicked')`
 * query in getOrCreateDraft.
 */
export const TERMINAL_STATUSES = ["approved", "rejected", "kicked"] as const;

/**
 * Allowed transitions, keyed by source status. The gate itself only ever drives
 * draft -> submitted; the rest are produced by staff review (review.ts) and are
 * declared here so the whole lifecycle is described in one place.
 */
export const GATE_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  draft: ["submitted"],
  submitted: ["needs_info", "approved", "rejected", "kicked"],
  needs_info: ["submitted", "approved", "rejected", "kicked"],
  approved: [],
  rejected: [],
  kicked: [],
};

export function isDraft(status: string): status is "draft" {
  return status === "draft";
}

export function isSubmitted(status: string): status is "submitted" {
  return status === "submitted";
}

export function isActiveStatus(status: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

export function isTerminalStatus(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** Whether `from -> to` is a transition the lifecycle permits. */
export function canTransition(from: string, to: string): boolean {
  const allowed = GATE_TRANSITIONS[from as ApplicationStatus];
  return allowed ? (allowed as readonly string[]).includes(to) : false;
}

/**
 * Outcome of inspecting a draft row on modal submit, so the handler can branch
 * without re-deriving status semantics inline:
 *  - "submitted": already submitted; show the done confirmation.
 *  - "open":      still a draft; safe to persist the page / submit.
 *  - "closed":    any other status (terminal or unexpected); tell the user to
 *                 press Start again.
 */
export type DraftDisposition = "submitted" | "open" | "closed";

export function classifyDraftStatus(status: string): DraftDisposition {
  if (isSubmitted(status)) return "submitted";
  if (isDraft(status)) return "open";
  return "closed";
}
