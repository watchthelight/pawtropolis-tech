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
;

// Re-export tickets
export {
  
  
  getTicketByThread,
  
  
  
  
  
  
  
  
} from "./modmail/tickets.js";

// Re-export transcript functions
;

// Re-export routing functions
export {
  // Embed builders
  
  
  // Message forwarding tracking
  
  
  // Routing
  routeThreadToDm,
  routeDmToThread,
  // Inbound message handlers
  
  
} from "./modmail/routing.js";

// Re-export thread operations
export {
  // Constants
  OPEN_MODMAIL_THREADS,
  // Startup/hydration
  hydrateOpenModmailThreadsOnStartup,
  retrofitAllGuildsOnStartup,
  retrofitModmailParentsForGuild,
  
  // Thread operations
  openPublicModmailThreadFor,
  
  
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
