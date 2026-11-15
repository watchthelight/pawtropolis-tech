// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/researchDb.test.ts
 * WHAT: Tests for the dashboard's connection to the score file.
 * WHY: The file belongs to the research job. The dashboard must find it where
 *      the job puts it, must not be able to change it, and must keep working
 *      on a host where the job has never run.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "../../src/features/research/store.js";

const saved = { DB_PATH: process.env.DB_PATH, RESEARCH_DB_PATH: process.env.RESEARCH_DB_PATH };

let dir: string;
let opened: Database.Database[];

/** The module reads its paths when it is loaded, so each test loads it again. */
async function loadWith(env: { DB_PATH?: string; RESEARCH_DB_PATH?: string }) {
  for (const key of ["DB_PATH", "RESEARCH_DB_PATH"] as const) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  vi.resetModules();
  const { researchDb } = await import("$lib/server/researchDb");
  return () => {
    const connection = researchDb();
    if (connection && !opened.includes(connection)) opened.push(connection);
    return connection;
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "quality-file-"));
  opened = [];
});

afterEach(() => {
  for (const connection of opened) connection.close();
  for (const key of ["DB_PATH", "RESEARCH_DB_PATH"] as const) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("researchDb", () => {
  it("gives null while the file is missing and opens it once the job has written it", async () => {
    const file = path.join(dir, "scores.db");
    const researchDb = await loadWith({ RESEARCH_DB_PATH: file });
    expect(researchDb()).toBeNull();

    new Store(file).close();

    const connection = researchDb();
    expect(connection).not.toBeNull();
    expect(connection!.prepare("SELECT COUNT(*) AS n FROM message_scores").get()).toEqual({ n: 0 });
    expect(researchDb()).toBe(connection);
  });

  it("cannot write to the file", async () => {
    const file = path.join(dir, "scores.db");
    new Store(file).close();
    const researchDb = await loadWith({ RESEARCH_DB_PATH: file });

    expect(() =>
      researchDb()!.prepare("INSERT INTO meta (key, value) VALUES ('total', '1')").run()
    ).toThrow(/readonly/i);
  });

  it("looks for research.db next to the bot's database when no path is set", async () => {
    new Store(path.join(dir, "research.db")).close();
    const researchDb = await loadWith({ DB_PATH: path.join(dir, "data.db") });

    expect(researchDb()).not.toBeNull();
  });
});
