/**
 * Pawtropolis Tech -- src/features/tickets/counters.ts
 * WHAT: Atomically allocates the next ticket number for a given counter key.
 * WHY: Every new ticket needs a unique, monotonically-increasing number per
 *      type. Two button clicks landing on the same SQLite connection at the
 *      same time must NOT both get the same number. The transaction here
 *      guarantees mutual exclusion under WAL mode.
 *
 * Pattern mirrors src/features/artistRotation/queue.ts:374 (db.transaction).
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { db } from "../../db/db.js";

// The increment statement is lazy-prepared on first call rather than at
// module import. Eager prepare requires ticket_counter (migration 067) to
// exist before the module loads, which breaks any test setup or fresh DB
// where that migration has not run. Lazy prepare keeps the module
// importable even when the table is absent; allocateNextNumber will
// throw a clear "missed migration seed" error on first call instead.
let cachedIncrementStmt:
  | ReturnType<typeof db.prepare>
  | null = null;

function getIncrementStmt() {
  if (!cachedIncrementStmt) {
    cachedIncrementStmt = db.prepare(
      `UPDATE ticket_counter
         SET current_value = current_value + 1,
             updated_at    = unixepoch()
       WHERE key = ?
       RETURNING current_value`,
    );
  }
  return cachedIncrementStmt;
}

/**
 * Allocate and return the next number for the given counter key. Throws if the
 * counter row doesn't exist (which would indicate a missed migration seed).
 */
export function allocateNextNumber(counterKey: string): number {
  return db.transaction(() => {
    const row = getIncrementStmt().get(counterKey) as
      | { current_value: number }
      | undefined;
    if (!row) {
      throw new Error(
        `[tickets/counters] no counter row for key '${counterKey}' — was migration 067 applied?`
      );
    }
    return row.current_value;
  })();
}

