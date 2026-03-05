/**
 * Pawtropolis Tech -- src/db/utils.ts
 * Shared database utilities.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

/** Regex for validating SQL identifiers (table names, column names) to prevent injection. */
export const SQL_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
