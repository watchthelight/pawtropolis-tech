// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/db/columnUtil.test.ts
 * WHAT: Unit tests for the addColumnIfMissing utility.
 * WHY: addColumnIfMissing runs at startup against legacy production
 *      databases. SQL identifier validation must reject anything that
 *      could smuggle DDL through PRAGMA / ALTER. The no-such-table
 *      branch must stay non-fatal so a fresh DB can boot.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addColumnIfMissing,
  validateColumnDefinition,
  validateIdentifier,
  type ColumnHostDb,
} from "../../src/db/columnUtil.js";

function makeStubDb(opts: {
  pragmaImpl?: (stmt: string) => unknown;
  prepareImpl?: ReturnType<typeof vi.fn>;
}): ColumnHostDb & { __runs: string[] } {
  const runs: string[] = [];
  return {
    pragma:
      opts.pragmaImpl ??
      ((_stmt: string) => {
        return [];
      }),
    prepare:
      (opts.prepareImpl as ((sql: string) => { run: () => void }) | undefined) ??
      ((sql: string) => ({
        run: () => {
          runs.push(sql);
        },
      })),
    __runs: runs,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("validateIdentifier", () => {
  it("accepts simple identifiers", () => {
    expect(() => validateIdentifier("table", "user_activity")).not.toThrow();
    expect(() => validateIdentifier("column", "panic_mode")).not.toThrow();
  });

  it("accepts identifiers with digits after the first char", () => {
    expect(() => validateIdentifier("column", "col_42_x")).not.toThrow();
  });

  it("rejects empty strings", () => {
    expect(() => validateIdentifier("table", "")).toThrow(/Invalid table name/);
  });

  it("rejects leading digit", () => {
    expect(() => validateIdentifier("column", "1col")).toThrow(/Invalid column name/);
  });

  it("rejects spaces", () => {
    expect(() => validateIdentifier("table", "user activity")).toThrow();
  });

  it("rejects hyphens", () => {
    expect(() => validateIdentifier("column", "col-name")).toThrow();
  });

  it("rejects backticks and quotes", () => {
    expect(() => validateIdentifier("table", "`evil`")).toThrow();
    expect(() => validateIdentifier("column", '"evil"')).toThrow();
  });

  it("rejects parentheses", () => {
    expect(() => validateIdentifier("table", "table(1=1)")).toThrow();
  });

  it("rejects single quotes", () => {
    expect(() => validateIdentifier("column", "col'; DROP TABLE")).toThrow();
  });
});

describe("validateColumnDefinition", () => {
  it("accepts simple types and defaults", () => {
    expect(() => validateColumnDefinition("TEXT")).not.toThrow();
    expect(() => validateColumnDefinition("INTEGER NOT NULL DEFAULT 0")).not.toThrow();
    expect(() => validateColumnDefinition("REAL DEFAULT 0.7")).not.toThrow();
  });

  it("rejects definitions with semicolons", () => {
    expect(() =>
      validateColumnDefinition("TEXT; DROP TABLE users"),
    ).toThrow(/Invalid column definition/);
  });

  it("rejects definitions with -- comment", () => {
    expect(() =>
      validateColumnDefinition("TEXT -- malicious"),
    ).toThrow(/Invalid column definition/);
  });

  it("rejects definitions with /* comment", () => {
    expect(() =>
      validateColumnDefinition("TEXT /* evil */"),
    ).toThrow(/Invalid column definition/);
  });
});

describe("addColumnIfMissing", () => {
  it("adds the column when missing and reports 'added'", () => {
    const db = makeStubDb({});
    const onAdded = vi.fn();

    const result = addColumnIfMissing(db, "user_activity", "panic_mode", "INTEGER", {
      onAdded,
    });

    expect(result).toBe("added");
    expect(db.__runs).toEqual([
      "ALTER TABLE user_activity ADD COLUMN panic_mode INTEGER",
    ]);
    expect(onAdded).toHaveBeenCalledWith("user_activity", "panic_mode");
  });

  it("returns 'exists' when the column is already present and skips ALTER", () => {
    const db = makeStubDb({
      pragmaImpl: () => [{ name: "panic_mode" }, { name: "id" }],
    });
    const onAdded = vi.fn();

    const result = addColumnIfMissing(db, "user_activity", "panic_mode", "INTEGER", {
      onAdded,
    });

    expect(result).toBe("exists");
    expect(db.__runs).toEqual([]);
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("returns 'no_table' when PRAGMA reports the table is missing", () => {
    const db = makeStubDb({
      pragmaImpl: () => {
        const err = new Error("no such table: legacy_thing");
        throw err;
      },
    });
    const onNoTable = vi.fn();

    const result = addColumnIfMissing(db, "legacy_thing", "x", "INTEGER", {
      onNoTable,
    });

    expect(result).toBe("no_table");
    expect(onNoTable).toHaveBeenCalledWith("legacy_thing", "x");
  });

  it("propagates other PRAGMA errors", () => {
    const db = makeStubDb({
      pragmaImpl: () => {
        throw new Error("disk I/O error");
      },
    });

    expect(() =>
      addColumnIfMissing(db, "user_activity", "x", "INTEGER"),
    ).toThrow(/disk I\/O error/);
  });

  it("rejects malicious table names before reaching PRAGMA", () => {
    const pragmaSpy = vi.fn(() => []);
    const db = makeStubDb({ pragmaImpl: pragmaSpy });

    expect(() =>
      addColumnIfMissing(db, "user_activity); DROP TABLE", "x", "INTEGER"),
    ).toThrow(/Invalid table name/);
    expect(pragmaSpy).not.toHaveBeenCalled();
  });

  it("rejects malicious column names before reaching PRAGMA", () => {
    const pragmaSpy = vi.fn(() => []);
    const db = makeStubDb({ pragmaImpl: pragmaSpy });

    expect(() =>
      addColumnIfMissing(db, "user_activity", "x; DROP TABLE", "INTEGER"),
    ).toThrow(/Invalid column name/);
    expect(pragmaSpy).not.toHaveBeenCalled();
  });

  it("rejects definitions that contain a semicolon", () => {
    const db = makeStubDb({});
    expect(() =>
      addColumnIfMissing(db, "user_activity", "x", "INTEGER; DROP TABLE users"),
    ).toThrow(/Invalid column definition/);
  });

  it("rejects definitions that contain a -- comment", () => {
    const db = makeStubDb({});
    expect(() =>
      addColumnIfMissing(db, "user_activity", "x", "INTEGER -- evil"),
    ).toThrow(/Invalid column definition/);
  });

  it("rejects definitions that contain a /* comment", () => {
    const db = makeStubDb({});
    expect(() =>
      addColumnIfMissing(db, "user_activity", "x", "INTEGER /* x */"),
    ).toThrow(/Invalid column definition/);
  });
});
