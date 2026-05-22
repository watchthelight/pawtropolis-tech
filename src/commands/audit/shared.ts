/**
 * Pawtropolis Tech -- src/commands/audit/shared.ts
 * WHAT: Shared constants + utilities for /audit subcommand modules.
 * WHY: ALLOWED_ROLES defines the permission set used by every subcommand;
 *      generateNonce ties confirmation buttons to a specific invocation.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { ROLE_IDS } from "../../lib/roles.js";

/**
 * Allowed role IDs (Admin+ and Server Dev).
 * Uses centralized ROLE_IDS from roles.ts for consistency.
 */
export const ALLOWED_ROLES = [
  ROLE_IDS.ADMINISTRATOR,
  ROLE_IDS.SENIOR_ADMIN,
  ROLE_IDS.COMMUNITY_MANAGER,
  ROLE_IDS.SERVER_DEV,
];

/**
 * Nonce generation for button security.
 * WHY: Without this, anyone could craft a button customId and trigger audits.
 * The nonce ties the button to the specific command invocation. Not
 * cryptographically secure (Math.random is PRNG), but good enough to prevent
 * casual button spoofing.
 */
export function generateNonce(): string {
  return Math.random().toString(16).slice(2, 10);
}
