/**
 * Pawtropolis Tech — src/features/gate.ts
 * WHAT: Barrel for the gate feature. The implementation lives in src/features/gate/*:
 *  - flow.ts:        application status lifecycle (state machine, predicates)
 *  - drafts.ts:      question/modal builders + draft persistence
 *  - handlers.ts:    Start button / modal-submit / Done interaction handlers
 *  - entryPanel.ts:  gate entry panel build/find/ensure/refresh (ensureGateEntry)
 *  - scan.ts:        avatar scan queueing
 *  - constants.ts:   brand color + footer sentinels
 * WHY: Keeps applicant-facing interactions and staff review linkage reachable
 *  from one import path while each concern stays in its own module (#00011).
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
export * from "./gate/drafts.js";
export { BRAND_COLOR } from "./gate/constants.js";
export { queueAvatarScan } from "./gate/scan.js";
export {
  buildGateEntryPayload,
  
  ensureGateEntry,
  ensureGateEntryStartup,
  refreshGateEntry,
  
} from "./gate/entryPanel.js";
export { handleStartButton, handleGateModalSubmit, handleDoneButton } from "./gate/handlers.js";
