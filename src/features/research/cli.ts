/**
 * Pawtropolis Tech -- src/features/research/cli.ts
 * WHAT: The command line of the chat research job: reads the flags, finds the
 *       files, runs once and prints one line of JSON with what it did.
 * WHY: The job runs from cron, outside the bot. It must never be imported by
 *      the bot process: scoring is CPU work, and the bot has one thread for
 *      Discord. scripts/research.ts is the entry and holds nothing but the
 *      call to main().
 *
 *      The line it prints has counts and times only. No message text, no
 *      author and no score of a single message ever goes to a log.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import path from "node:path";
import { parseArgs } from "node:util";
import { Archive } from "./archive.js";
import { loadEffortModel } from "./effortModel.js";
import {
  EMBEDDING_ID,
  createEmbedder,
  fetchModelFiles,
  loadTransformers,
  type Embedder,
  type FetchLike,
} from "./embedder.js";
import { runResearch } from "./run.js";
import { Store } from "./store.js";
import { loadWordList } from "./text.js";

export const USAGE = `Chat research job: scores the messages of the main chat.

  node dist/scripts/research.js [options]     one run
  node dist/scripts/research.js fetch-model   download the pinned model files

A run without --full, --from or --to looks at the last three days. The first
run after 09:00 UTC of a day goes over the whole channel.

  --full               go over the whole channel now
  --from <time>        work on one part of the channel: 2024-01-31 or epoch seconds
  --to <time>          end of that part (not included)
  --no-finalize        write scores only, leave reply counts and weeks alone
  --max <n>            most messages scored in one run (default 2000, 0: no limit)
  --threads <n>        CPU threads for the embedding model (default 2)
  --guild <id>         default: GUILD_ID
  --channel <id>       default: the general channel in the guild's config
  --db <file>          the bot's database (default: DB_PATH, then data/data.db)
  --store <file>       the score file (default: RESEARCH_DB_PATH, then
                       research.db next to the bot's database)
  --model-dir <dir>    the model files (default: research-model next to the database)
  --package-dir <dir>  the folder the embedding library is installed in (default: research)
`;

const EFFORT_MODEL_FILE = path.join("models", "effort_v1.json");
const LOWLIST_FILE = path.join("scripts", "lowlist.json");
const FILLER_BANK_FILE = path.join("scripts", "filler-bank.json");

export interface CliDeps {
  print: (line: string) => void;
  nowS: () => number;
  fetchFile: FetchLike;
  makeEmbedder: (packageDir: string, modelDir: string, threads: number) => Promise<Embedder>;
}

const defaultDeps: CliDeps = {
  print: (line) => void process.stdout.write(`${line}\n`),
  nowS: () => Math.floor(Date.now() / 1000),
  fetchFile: (url) => fetch(url),
  makeEmbedder: (packageDir, modelDir, threads) =>
    createEmbedder({ library: loadTransformers(packageDir), modelDir, threads }),
};

/** 2024-01-31, a full ISO time or epoch seconds. */
function parseTime(flag: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.floor(Date.parse(value) / 1000);
  if (!Number.isFinite(seconds)) throw new Error(`--${flag} is not a time: ${value}`);
  return seconds;
}

function parseCount(flag: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`--${flag} is not a whole number: ${value}`);
  return Number(value);
}

/** Runs the command line. Returns the exit code; a failed run throws. */
export async function main(
  argv: string[],
  env: Record<string, string | undefined>,
  overrides: Partial<CliDeps> = {}
): Promise<number> {
  const deps = { ...defaultDeps, ...overrides };
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      full: { type: "boolean" },
      from: { type: "string" },
      to: { type: "string" },
      "no-finalize": { type: "boolean" },
      max: { type: "string" },
      threads: { type: "string" },
      guild: { type: "string" },
      channel: { type: "string" },
      db: { type: "string" },
      store: { type: "string" },
      "model-dir": { type: "string" },
      "package-dir": { type: "string" },
    },
  });
  const command = positionals[0] ?? "run";
  if (values.help || positionals.length > 1 || (command !== "run" && command !== "fetch-model")) {
    deps.print(USAGE);
    return values.help ? 0 : 2;
  }

  const dbPath = values.db || env.DB_PATH || path.join("data", "data.db");
  const dataDir = path.dirname(dbPath);
  const storePath = values.store || env.RESEARCH_DB_PATH || path.join(dataDir, "research.db");
  const modelDir = values["model-dir"] || path.join(dataDir, "research-model");
  const packageDir = values["package-dir"] || "research";
  const at = (): string => new Date(deps.nowS() * 1000).toISOString();

  if (command === "fetch-model") {
    const fetched = await fetchModelFiles(modelDir, deps.fetchFile);
    deps.print(JSON.stringify({ at: at(), fetched }));
    return 0;
  }

  const fromS = parseTime("from", values.from);
  const toS = parseTime("to", values.to);
  if (values.full && (fromS !== undefined || toS !== undefined)) {
    throw new Error("--full goes over the whole channel: it does not go with --from or --to");
  }
  const maxMessages = parseCount("max", values.max, 2000);
  const threads = parseCount("threads", values.threads, 2);
  if (threads < 1) throw new Error("--threads must be at least 1");

  const guildId = values.guild || env.GUILD_ID;
  if (!guildId) throw new Error("no guild: pass --guild or set GUILD_ID");

  const startedMs = Date.now();
  const archive = new Archive(dbPath, guildId);
  try {
    const channelId = values.channel || archive.generalChannel();
    if (!channelId) {
      throw new Error("no channel: pass --channel or set the general channel of the guild");
    }
    archive.useChannel(channelId);

    const model = loadEffortModel(EFFORT_MODEL_FILE);
    const store = new Store(storePath);
    try {
      let embedder: Promise<Embedder> | undefined;
      const result = await runResearch({
        archive,
        store,
        model,
        lowlist: loadWordList(LOWLIST_FILE, "tokens"),
        fillerBank: loadWordList(FILLER_BANK_FILE, "phrases"),
        identity: {
          guild_id: guildId,
          channel_id: channelId,
          effort_model: model.version,
          embedding_model: EMBEDDING_ID,
        },
        embedder: () => (embedder ??= deps.makeEmbedder(packageDir, modelDir, threads)),
        nowS: deps.nowS(),
        mode: values.full ? "full" : fromS !== undefined || toS !== undefined ? "range" : "auto",
        fromS,
        toS,
        finalize: !values["no-finalize"],
        maxMessages,
      });
      deps.print(JSON.stringify({ at: at(), ...result, ms: Date.now() - startedMs }));
      return 0;
    } finally {
      store.close();
    }
  } finally {
    archive.close();
  }
}
