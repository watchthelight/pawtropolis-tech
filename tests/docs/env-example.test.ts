/**
 * Pawtropolis Tech -- tests/docs/env-example.test.ts
 * WHAT: Every environment variable the code reads is documented in an example file,
 *       and every documented key is read somewhere.
 * WHY: 70 names were read but undocumented and 8 were documented but dead (#00272).
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".svelte-kit" || entry === "build") continue;
      out.push(...walk(full, exts));
    } else if (exts.some((e) => entry.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

function namesRead(files: string[], patterns: RegExp[]): Set<string> {
  const names = new Set<string>();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const re of patterns) {
      for (const m of text.matchAll(re)) names.add(m[1]!);
    }
  }
  return names;
}

function namesDocumented(file: string): Set<string> {
  const text = readFileSync(path.join(ROOT, file), "utf8");
  return new Set([...text.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!));
}

const PROCESS_ENV = /process\.env\.([A-Z][A-Z0-9_]+)/g;
const WEB_HELPERS = /get(?:Required|Optional)\("([A-Z][A-Z0-9_]+)"\)/g;
const PUBLIC_STATIC = /\b(PUBLIC_[A-Z0-9_]+)\b/g;
const SHELL_EXPANSION = /\$\{?([A-Z][A-Z0-9_]+)\}?/g;

/** Read by the bot but deliberately not in .env.example. */
const BOT_UNDOCUMENTED_OK: Array<string | RegExp> = [
  /_DISABLED$/, // per-scheduler test toggles
  "DB_TRACE",
  "DEBUG_WIDE_EVENTS",
  "TRACE_INTERACTIONS",
  "VERBOSE_PAYLOADS",
  "MOD_METRICS_TTL_MS",
  "VITEST_WORKER_ID",
  "VITEST_POOL_ID",
  "RUN_THREAD_MIGRATION", // one-shot migration switch
  "BUILD_DEPLOY_ID", // written to .env.build by scripts/inject-build-info.ts
  "BUILD_GIT_SHA",
  "BUILD_TIMESTAMP",
  "USER", // OS identity for the recovery CLI audit note
  "USERNAME",
];

/** Read by the dashboard but deliberately not in web/.env.example. */
const WEB_UNDOCUMENTED_OK: Array<string | RegExp> = ["NODE_ENV", "BUILD_GIT_SHA"];

function allowed(name: string, list: Array<string | RegExp>): boolean {
  return list.some((a) => (typeof a === "string" ? a === name : a.test(name)));
}

describe(".env.example (bot)", () => {
  const read = namesRead(walk(path.join(ROOT, "src"), [".ts"]), [PROCESS_ENV]);
  const documented = namesDocumented(".env.example");

  it("documents every variable src/ reads", () => {
    const missing = [...read]
      .filter((n) => !documented.has(n) && !allowed(n, BOT_UNDOCUMENTED_OK))
      .sort();
    expect(missing).toEqual([]);
  });

  it("documents nothing that is never read", () => {
    const consumers = [
      ...walk(path.join(ROOT, "src"), [".ts"]),
      ...walk(path.join(ROOT, "scripts"), [".ts", ".mjs", ".cjs", ".js", ".sh", ".yml"]),
      ...walk(path.join(ROOT, "web/src"), [".ts", ".svelte"]),
      path.join(ROOT, "deploy.sh"),
      path.join(ROOT, "ecosystem.config.cjs"),
    ];
    const used = namesRead(consumers, [PROCESS_ENV, WEB_HELPERS, PUBLIC_STATIC, SHELL_EXPANSION]);
    const dead = [...documented].filter((n) => !used.has(n)).sort();
    expect(dead).toEqual([]);
  });
});

describe("web/.env.example (dashboard)", () => {
  const files = walk(path.join(ROOT, "web/src"), [".ts", ".svelte"]);
  const read = namesRead(files, [PROCESS_ENV, WEB_HELPERS]);
  const documented = namesDocumented("web/.env.example");

  it("documents every variable web/src reads", () => {
    const missing = [...read]
      .filter((n) => !documented.has(n) && !allowed(n, WEB_UNDOCUMENTED_OK))
      .sort();
    expect(missing).toEqual([]);
  });

  it("documents nothing that is never read", () => {
    const used = namesRead(files, [PROCESS_ENV, WEB_HELPERS, PUBLIC_STATIC]);
    const dead = [...documented].filter((n) => !used.has(n)).sort();
    expect(dead).toEqual([]);
  });
});
