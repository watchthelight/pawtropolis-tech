/**
 * Pawtropolis Tech -- tests/features/research/cli.test.ts
 * WHAT: Tests for the command line of the research job.
 * WHY: Cron starts it with no one watching. A flag that is read wrong, a
 *      default path that points somewhere else or a log line with message text
 *      in it would go unnoticed for weeks.
 * NOTE: The runs use the real effort model and word lists of the repo, a
 *       throwaway archive and a stand-in for the embedding model.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USAGE, main, type CliDeps } from "../../../src/features/research/cli.js";
import {
  CHANNEL,
  GUILD,
  addMessages,
  changeArchive,
  createArchiveDb,
  fakeEmbedder,
} from "./helpers.js";

const DAY = 86400;
// Wednesday 2024-01-10 12:00 UTC
const NOW = 1704067200 + 9 * DAY + 12 * 3600;

let dir: string;
let dbFile: string;
let printed: string[];
let fake: ReturnType<typeof fakeEmbedder>;
let makeEmbedder: ReturnType<typeof vi.fn<CliDeps["makeEmbedder"]>>;
let deps: Partial<CliDeps>;

const lastLine = (): Record<string, unknown> =>
  JSON.parse(printed.at(-1) ?? "{}") as Record<string, unknown>;

function metaOf(file: string): Record<string, string> {
  const db = new Database(file, { readonly: true });
  const rows = db.prepare("SELECT key, value FROM meta").all() as { key: string; value: string }[];
  db.close();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "research-cli-"));
  dbFile = path.join(dir, "data.db");
  createArchiveDb(dbFile);
  printed = [];
  fake = fakeEmbedder();
  makeEmbedder = vi.fn<CliDeps["makeEmbedder"]>(async () => fake.embedder);
  deps = { print: (line) => printed.push(line), nowS: () => NOW, makeEmbedder };
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("research command line", () => {
  it("prints its usage on --help", async () => {
    expect(await main(["--help"], {}, deps)).toBe(0);
    expect(printed).toEqual([USAGE]);
  });

  it("prints its usage and fails on a command it does not know", async () => {
    expect(await main(["rebuild"], {}, deps)).toBe(2);
    expect(await main(["run", "twice"], {}, deps)).toBe(2);
    expect(printed).toEqual([USAGE, USAGE]);
  });

  it("refuses a flag it does not know", async () => {
    await expect(main(["--fast"], {}, deps)).rejects.toThrow(/Unknown option '--fast'/);
  });

  it("needs a guild", async () => {
    await expect(main(["--db", dbFile], {}, deps)).rejects.toThrow(
      "no guild: pass --guild or set GUILD_ID"
    );
  });

  it("needs a channel when the guild has no general channel", async () => {
    changeArchive(dbFile, "UPDATE guild_config SET general_channel_id = NULL");
    await expect(main(["--db", dbFile], { GUILD_ID: GUILD }, deps)).rejects.toThrow(
      "no channel: pass --channel or set the general channel of the guild"
    );
  });

  it.each([
    [["--max", "many"], "--max is not a whole number: many"],
    [["--threads", "0"], "--threads must be at least 1"],
    [["--threads", "2.5"], "--threads is not a whole number: 2.5"],
    [["--from", "last tuesday"], "--from is not a time: last tuesday"],
    [["--full", "--to", "2024-01-01"], "it does not go with --from or --to"],
  ])("refuses %j", async (flags, message) => {
    await expect(main(["--db", dbFile, ...flags], { GUILD_ID: GUILD }, deps)).rejects.toThrow(
      message
    );
  });

  it("fails on a database that is not there, without creating one", async () => {
    const missing = path.join(dir, "nothing", "data.db");
    await expect(main(["--db", missing], { GUILD_ID: GUILD }, deps)).rejects.toThrow();
    expect(fs.existsSync(path.dirname(missing))).toBe(false);
  });

  it("runs with the paths and the guild from the environment", async () => {
    addMessages(dbFile, [
      { id: "1", at: NOW - 500, content: "does this brush work?" },
      { id: "2", at: NOW - 400, content: "yes it does", replyTo: "1" },
    ]);
    const storeFile = path.join(dir, "elsewhere", "scores.db");
    fs.mkdirSync(path.dirname(storeFile));

    const code = await main(
      [],
      { GUILD_ID: GUILD, DB_PATH: dbFile, RESEARCH_DB_PATH: storeFile },
      deps
    );

    expect(code).toBe(0);
    expect(printed).toHaveLength(1);
    // The first run of a file is a full pass.
    expect(lastLine()).toMatchObject({
      at: "2024-01-10T12:00:00.000Z",
      mode: "full",
      scored: 2,
      removed: 0,
      pending: 0,
      replyUpdates: 1,
      weeksBuilt: 1,
      total: 2,
    });
    expect(typeof lastLine().ms).toBe("number");
    expect(metaOf(storeFile)).toMatchObject({
      guild_id: GUILD,
      channel_id: CHANNEL,
      effort_model: "effort_v1",
      embedding_model: "Xenova/all-MiniLM-L6-v2@751bff37182d/fp32",
      total: "2",
    });
  });

  it("prints counts and never a message, an author or a channel", async () => {
    addMessages(dbFile, [
      { id: "1", at: NOW - 500, author: "author-xyz", content: "secret words" },
    ]);
    await main(["--db", dbFile], { GUILD_ID: GUILD }, deps);
    expect(Object.keys(lastLine()).sort()).toEqual([
      "at",
      "mode",
      "ms",
      "pending",
      "removed",
      "replyP95",
      "replyUpdates",
      "scored",
      "total",
      "weeksBuilt",
    ]);
    expect(printed.join("\n")).not.toMatch(/secret|author-xyz|channel-general|guild-1/);
  });

  it("keeps the score file next to the database unless told otherwise", async () => {
    await main(["--db", dbFile], { GUILD_ID: GUILD }, deps);
    expect(fs.existsSync(path.join(dir, "research.db"))).toBe(true);

    const other = path.join(dir, "other.db");
    await main(["--db", dbFile, "--store", other, "--guild", GUILD], {}, deps);
    expect(fs.existsSync(other)).toBe(true);
  });

  it("loads the model from the folders it was pointed at, and only when needed", async () => {
    await main(["--db", dbFile], { GUILD_ID: GUILD }, deps);
    expect(makeEmbedder).not.toHaveBeenCalled();

    addMessages(dbFile, [{ id: "1", at: NOW - 500 }]);
    await main(
      ["--db", dbFile, "--threads", "6", "--model-dir", "m", "--package-dir", "p"],
      { GUILD_ID: GUILD },
      deps
    );
    expect(makeEmbedder).toHaveBeenCalledExactlyOnceWith("p", "m", 6);

    addMessages(dbFile, [{ id: "2", at: NOW - 400 }]);
    await main(["--db", dbFile], { GUILD_ID: GUILD }, deps);
    expect(makeEmbedder).toHaveBeenLastCalledWith("research", path.join(dir, "research-model"), 2);
  });

  it("works on the channel it was given", async () => {
    addMessages(dbFile, [
      { id: "1", at: NOW - 500 },
      { id: "2", at: NOW - 400, channel: "side-channel" },
      { id: "3", at: NOW - 300, channel: "side-channel" },
    ]);
    const store = path.join(dir, "side.db");
    await main(
      ["--db", dbFile, "--store", store, "--channel", "side-channel"],
      { GUILD_ID: GUILD },
      deps
    );
    expect(lastLine()).toMatchObject({ scored: 2 });
    expect(metaOf(store).channel_id).toBe("side-channel");

    // The same file cannot be pointed at the main chat afterwards.
    await expect(
      main(["--db", dbFile, "--store", store], { GUILD_ID: GUILD }, deps)
    ).rejects.toThrow("belongs to another series");
  });

  it("scores a part of the channel with --from, --to and --no-finalize", async () => {
    addMessages(dbFile, [
      { id: "1", at: Date.parse("2023-11-05T10:00:00Z") / 1000 },
      { id: "2", at: Date.parse("2023-11-20T10:00:00Z") / 1000 },
      { id: "3", at: Date.parse("2023-12-05T10:00:00Z") / 1000 },
    ]);
    const flags = ["--db", dbFile, "--max", "0", "--no-finalize"];
    await main([...flags, "--from", "2023-11-01", "--to", "2023-12-01"], { GUILD_ID: GUILD }, deps);
    expect(lastLine()).toMatchObject({ mode: "range", scored: 2, weeksBuilt: 0, total: 2 });

    const december = String(Date.parse("2023-12-01T00:00:00Z") / 1000);
    await main([...flags, "--from", december], { GUILD_ID: GUILD }, deps);
    expect(lastLine()).toMatchObject({ mode: "range", scored: 1, weeksBuilt: 0, total: 3 });

    await main(["--db", dbFile, "--full"], { GUILD_ID: GUILD }, deps);
    expect(lastLine()).toMatchObject({ mode: "full", scored: 0, weeksBuilt: 3 });
  });

  it("stops at --max and says how many are left", async () => {
    addMessages(
      dbFile,
      Array.from({ length: 5 }, (_, i) => ({ id: String(i + 1), at: NOW - 500 + i }))
    );
    await main(["--db", dbFile, "--max", "3"], { GUILD_ID: GUILD }, deps);
    expect(lastLine()).toMatchObject({ scored: 3, pending: 2 });
  });

  it("downloads the model files on fetch-model", async () => {
    const fetchFile = vi.fn<CliDeps["fetchFile"]>(async () => ({
      ok: false,
      status: 404,
      arrayBuffer: async () => new ArrayBuffer(0),
    }));
    const modelDir = path.join(dir, "model");
    await expect(
      main(["fetch-model", "--model-dir", modelDir], {}, { ...deps, fetchFile })
    ).rejects.toThrow("download of config.json failed with status 404");
    expect(fetchFile).toHaveBeenCalledExactlyOnceWith(
      "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/751bff37182d3f1213fa05d7196b954e230abad9/config.json"
    );
    expect(fs.existsSync(modelDir)).toBe(false);
  });
});
