/**
 * Pawtropolis Tech -- src/features/modmail.ts
 * WHAT: Barrel re-export file for the modmail module.
 * WHY: Maintains backwards compatibility with existing imports.
 *
 * NOTE: All implementation code has been extracted to ./modmail/ submodules:
 *   - ./modmail/types.ts - Type definitions
 *   - ./modmail/tickets.ts - Ticket CRUD operations
 *   - ./modmail/transcript.ts - Transcript buffer management
 *   - ./modmail/routing.ts - Message routing between DM and threads
 *   - ./modmail/threads.ts - Thread operations (open, close, reopen)
 *   - ./modmail/handlers.ts - Button and context menu handlers
 *   - ./modmail/commands.ts - Slash commands
 *
 * DOCS:
 *  - Threads: https://discord.com/developers/docs/resources/channel#thread-create
 *  - DMs: https://discord.com/developers/docs/resources/user#create-dm
 *  - Barrel files: https://basarat.gitbook.io/typescript/main-1/barrel
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

// ===== Re-exports from submodules =====

// Re-export types
export type {
  ModmailTicketStatus,
  ModmailTicket,
  TranscriptLine,
  ModmailMessageMap,
  StaffToUserEmbedArgs,
  UserToStaffEmbedArgs,
  OpenPublicModmailThreadParams,
  CloseModmailThreadParams,
  ReopenModmailThreadParams,
} from "./modmail/types.js";

// Re-export tickets
export {
  createTicket,
  getOpenTicketByUser,
  getTicketByThread,
  getTicketById,
  findModmailTicketForApplication,
  updateTicketThread,
  closeTicket,
  reopenTicket,
  insertModmailMessage,
  getThreadIdForDmReply,
  getDmIdForThreadReply,
} from "./modmail/tickets.js";

// Re-export transcript functions
export {
  appendTranscript,
  getTranscriptBuffer,
  clearTranscriptBuffer,
  formatTranscript,
  formatContentWithAttachments,
  flushTranscript,
} from "./modmail/transcript.js";

// Re-export routing functions
export {
  // Embed builders
  buildStaffToUserEmbed,
  buildUserToStaffEmbed,
  // Message forwarding tracking
  isForwarded,
  markForwarded,
  // Routing
  routeThreadToDm,
  routeDmToThread,
  // Inbound message handlers
  handleInboundDmForModmail,
  handleInboundThreadMessageForModmail,
} from "./modmail/routing.js";

// Re-export thread operations
export {
  // Constants
  OPEN_MODMAIL_THREADS,
  // Startup/hydration
  hydrateOpenModmailThreadsOnStartup,
  retrofitAllGuildsOnStartup,
  retrofitModmailParentsForGuild,
  ensureParentPermsForMods,
  // Thread operations
  openPublicModmailThreadFor,
  closeModmailThread,
  reopenModmailThread,
  closeModmailForApplication,
} from "./modmail/threads.js";

// Re-export handlers (button, context menu)
export {
  handleModmailOpenButton,
  handleModmailCloseButton,
  handleModmailContextMenu,
} from "./modmail/handlers.js";

// Re-export commands
export {
  modmailCommand,
  executeModmailCommand,
  modmailContextMenu,
} from "./modmail/commands.js";

// Re-export dashboard bridge (interaction-free wrappers)
export {
  dashboardSendMessage,
  dashboardOpenThread,
  dashboardCloseThread,
  dashboardReopenThread,
} from "./modmail/dashboardBridge.js";
