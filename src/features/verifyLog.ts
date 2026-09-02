/**
 * Pawtropolis Tech -- src/features/verifyLog.ts
 * WHAT: Where /verify posts identity documents for staff review, and how those posts are
 *       recognised by the retention sweep that removes them after 30 days.
 * WHY: Shared by the command and the retention scheduler without pulling the command
 *      module (and its database statements) into the scheduler.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { env } from "../lib/env.js";

// Falls back to the original hardcoded channel so an unset env keeps current behaviour.
const DEFAULT_LOG_CHANNEL_ID = "1430015254053654599";

export function getVerifyLogChannelId(): string {
  return env.VERIFY_LOG_CHANNEL_ID ?? DEFAULT_LOG_CHANNEL_ID;
}

export const VERIFY_LOG_EMBED_TITLE = "Thin Line Verification";
export const VERIFY_LOG_DOCUMENT_TITLE_PREFIX = "Document ";
