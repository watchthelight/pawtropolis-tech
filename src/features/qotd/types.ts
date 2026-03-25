/**
 * Pawtropolis Tech — src/features/qotd/types.ts
 * WHAT: TypeScript types for the QOTD suggestion system
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

export type QotdSuggestionStatus = "pending" | "approved" | "rejected" | "used";

export interface QotdSuggestionRow {
  id: number;
  guild_id: string;
  user_id: string;
  question: string;
  status: QotdSuggestionStatus;
  short_code: string;
  review_message_id: string | null;
  reviewed_by: string | null;
  reviewed_at_s: number | null;
  reject_reason: string | null;
  used_by: string | null;
  used_at_s: number | null;
  created_at_s: number;
}
