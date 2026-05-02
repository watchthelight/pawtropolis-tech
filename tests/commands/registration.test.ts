// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/commands/registration.test.ts
 * WHAT: Drift protection for slash command registration.
 * WHY: Commands are listed in src/commands/buildCommands.ts (Discord registration)
 *      and the runtime dispatch table in src/index.ts. The runtimeManifest is the
 *      single source of truth that ties the two together. Tests assert that:
 *        1. every name registered with Discord has a handler manifest entry
 *        2. every manifest entry shows up in the Discord registration
 *        3. the gate command and its four aliases are present
 *        4. context menus are accounted for separately
 *      A drift would let a slash command exist on Discord with no handler,
 *      or vice versa, both of which produce silent breakage in production.
 */
import { describe, expect, it, vi } from "vitest";

// Stub the SQLite handle so command modules that prepare statements at import
// time (e.g., features/artJobs/store.ts) load without touching a real DB.
// Builders just need the schema-free `.data.toJSON()` shape; nothing here
// queries the DB.
vi.mock("../../src/db/db.js", () => {
  const stubStmt = {
    all: () => [],
    get: () => undefined,
    run: () => ({ changes: 0, lastInsertRowid: BigInt(0) }),
  };
  return {
    db: {
      prepare: () => stubStmt,
      pragma: () => undefined,
      transaction:
        (fn: (...args: unknown[]) => unknown) =>
        (...args: unknown[]) =>
          fn(...args),
      exec: () => undefined,
      close: () => undefined,
    },
  };
});

import { buildCommands } from "../../src/commands/buildCommands.js";
import {
  ALL_REGISTERED_NAMES,
  CONTEXT_MENU_NAMES,
  INTERNAL_ONLY_RUNTIME_NAMES,
  SLASH_COMMAND_NAMES,
} from "../../src/commands/runtimeManifest.js";

describe("command registration invariants", () => {
  // Build once, share across all assertions to avoid repeating Discord builder work.
  const built = buildCommands();
  const builtNames = built
    .map((entry) => (entry as { name?: string }).name)
    .filter((n): n is string => typeof n === "string");
  // Discord context menus carry a numeric `type` (User=2, Message=3) on their
  // JSON. Slash commands either omit `type` or set it to 1 (CHAT_INPUT).
  const builtSlashNames = built
    .filter((entry) => {
      const t = (entry as { type?: number }).type;
      return t === undefined || t === 1;
    })
    .map((entry) => (entry as { name: string }).name);
  const builtContextMenuNames = built
    .filter((entry) => {
      const t = (entry as { type?: number }).type;
      return t === 2 || t === 3;
    })
    .map((entry) => (entry as { name: string }).name);

  it("every slash command in buildCommands has a runtime manifest entry", () => {
    const missing = builtSlashNames.filter(
      (name) => !(SLASH_COMMAND_NAMES as readonly string[]).includes(name),
    );
    expect(missing).toEqual([]);
  });

  it("every slash command in the runtime manifest is in buildCommands", () => {
    const missing = SLASH_COMMAND_NAMES.filter(
      (name) =>
        !builtSlashNames.includes(name) &&
        !INTERNAL_ONLY_RUNTIME_NAMES.includes(name),
    );
    expect(missing).toEqual([]);
  });

  it("every context menu in buildCommands is in the manifest", () => {
    const missing = builtContextMenuNames.filter(
      (name) => !(CONTEXT_MENU_NAMES as readonly string[]).includes(name),
    );
    expect(missing).toEqual([]);
  });

  it("every context menu in the manifest is in buildCommands", () => {
    const missing = CONTEXT_MENU_NAMES.filter(
      (name) => !builtContextMenuNames.includes(name),
    );
    expect(missing).toEqual([]);
  });

  it("gate aliases (accept, reject, kick, unclaim) are registered", () => {
    for (const alias of ["accept", "reject", "kick", "unclaim"] as const) {
      expect(SLASH_COMMAND_NAMES).toContain(alias);
      expect(builtSlashNames).toContain(alias);
    }
  });

  it("manifest has no duplicate names", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const name of ALL_REGISTERED_NAMES) {
      if (seen.has(name)) duplicates.push(name);
      seen.add(name);
    }
    expect(duplicates).toEqual([]);
  });

  it("buildCommands produces no duplicate slash command names", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const name of builtSlashNames) {
      if (seen.has(name)) duplicates.push(name);
      seen.add(name);
    }
    expect(duplicates).toEqual([]);
  });

  it("buildCommands payload count matches manifest count", () => {
    // Quick total-count sanity: slash + context menu manifests should equal
    // the total number of JSON payloads sent to Discord (excluding any future
    // explicitly internal entries).
    expect(builtNames.length).toBe(
      SLASH_COMMAND_NAMES.length + CONTEXT_MENU_NAMES.length,
    );
  });
});
