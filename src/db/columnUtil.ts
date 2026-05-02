// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/db/columnUtil.ts
 * WHAT: Idempotent ALTER TABLE helper used by the schema self-heal layer.
 * WHY: Several files in the bot need to add a column if it does not exist
 *      yet (legacy DBs, ensure helpers). Extracted to make the validation
 *      and error-handling shape testable independently of the live db.ts.
 *
 * Security:
 *   - Table and column names are validated against SQL_IDENTIFIER_RE so a
 *     bad caller cannot smuggle DDL into PRAGMA / ALTER.
 *   - The column definition string is checked for ;, --, /* — these are
 *     the only characters that could chain a second statement or
 *     hide arbitrary SQL through a comment.
 *
 * Behavior:
 *   - Returns "added" if the column was missing and we ALTERed.
 *   - Returns "exists" if the column was already present.
 *   - Returns "no_table" if PRAGMA table_info reported no such table.
 *   - Throws on any other error (permissions, disk full, corruption).
 */

import { SQL_IDENTIFIER_RE } from "./utils.js";

export type ColumnAddResult = "added" | "exists" | "no_table";

export interface ColumnHostDb {
  pragma: (statement: string) => unknown;
  prepare: (sql: string) => { run: (...args: unknown[]) => unknown };
}

export interface AddColumnIfMissingOptions {
  /**
   * Logger sink for the success path. Optional — production callers pass
   * their pino-shaped logger; tests can omit this.
   */
  onAdded?: (table: string, column: string) => void;
  /**
   * Logger sink for the no-table path. Optional.
   */
  onNoTable?: (table: string, column: string) => void;
}

const DANGEROUS_DEFINITION_PATTERNS = [";", "--", "/*"] as const;

export function validateIdentifier(kind: "table" | "column", name: string): void {
  if (!SQL_IDENTIFIER_RE.test(name)) {
    throw new Error(`Invalid ${kind} name: ${name}`);
  }
}

export function validateColumnDefinition(definition: string): void {
  for (const pattern of DANGEROUS_DEFINITION_PATTERNS) {
    if (definition.includes(pattern)) {
      throw new Error(`Invalid column definition: ${definition}`);
    }
  }
}

/**
 * addColumnIfMissing
 *
 * Adds a column to a table when it is not already present. Returns a
 * discriminated outcome so callers can log/branch without needing a
 * try/catch around the no-such-table case.
 *
 * @throws Error when table/column name fails identifier validation
 * @throws Error when definition contains a SQL terminator or comment
 * @throws Error on unexpected SQLite failures
 */
export function addColumnIfMissing(
  db: ColumnHostDb,
  table: string,
  column: string,
  definition: string,
  options: AddColumnIfMissingOptions = {},
): ColumnAddResult {
  validateIdentifier("table", table);
  validateIdentifier("column", column);
  validateColumnDefinition(definition);

  let cols: Array<{ name: string }>;
  try {
    cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/no such table/i.test(msg)) {
      options.onNoTable?.(table, column);
      return "no_table";
    }
    throw err;
  }

  if (cols.some((c) => c.name === column)) {
    return "exists";
  }

  db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  options.onAdded?.(table, column);
  return "added";
}
