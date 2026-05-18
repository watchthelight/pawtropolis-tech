/**
 * Pawtropolis Tech -- src/features/review/handlers/index.ts
 * WHAT: Barrel file re-exporting all review handlers.
 * WHY: Single import point for all handler functions.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

// Re-export button handlers
export {
  handleReviewButton,
  handleModmailButton,
  handlePermRejectButton,
  handleCopyUidButton,
  handlePingInUnverified,
  handleDeletePing,
  handleVoteOutButton,
} from "./buttons.js";

// Re-export modal handlers
export {
  handleRejectModal,
  handleAcceptModal,
  handlePermRejectModal,
  handleKickModal,
  handleUnclaimModal,
  handleVoteOutModal,
} from "./modals.js";

// Re-export helpers for internal use
export {
  isStaff,
  requireInteractionStaff,
  resolveApplication,
  openRejectModal,
  openAcceptModal,
  openPermRejectModal,
  openKickModal,
  openUnclaimModal,
  openVoteOutModal,
  BUTTON_RE,
  MODAL_RE,
  ACCEPT_MODAL_RE,
} from "./helpers.js";

// Re-export action runners for internal use
export {
  runApproveAction,
  runRejectAction,
  runPermRejectAction,
  runKickAction,
  runVoteOutAction,
  runVoteOutRetractAction,
} from "./actionRunners.js";

// Re-export claim handlers for internal use
export {
  handleClaimToggle,
  handleUnclaimAction,
} from "./claimHandlers.js";
