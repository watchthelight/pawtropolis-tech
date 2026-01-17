/**
 * Pawtropolis Tech — src/features/report/types.ts
 * WHAT: TypeScript interfaces for the content report system.
 * WHY: Provides type safety for report data structures.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { User, Attachment } from "discord.js";

/**
 * Data structure for a content violation report.
 * Used when creating a new report thread.
 */
export interface ReportData {
  /** Reporter's Discord user */
  reporter: User;
  /** Reported user's Discord user */
  target: User;
  /** Description of the violation */
  reason: string;
  /** Optional screenshot attachment as evidence */
  evidence?: Attachment;
  /** Guild ID where the report was made */
  guildId: string;
  /** Short code for the report (HEX6 format) */
  code: string;
}

/**
 * Result of creating a report thread.
 */
export interface ReportResult {
  /** Whether the report was successfully created */
  success: boolean;
  /** The thread URL if successful */
  threadUrl?: string;
  /** Error message if failed */
  error?: string;
}
