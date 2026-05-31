// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * scripts/generate-badges.ts
 * WHAT: One-off helper to refresh the GitHub-renderable Discord badge cache.
 * WHY: Useful for local sanity checks and manual recovery without waiting
 *      for the daily refresh scheduler.
 *
 * Usage:
 *   npx tsx scripts/generate-badges.ts                # refresh all
 *   npx tsx scripts/generate-badges.ts --list         # print registry only
 *   npx tsx scripts/generate-badges.ts --id movie-tier-1
 *   npx tsx scripts/generate-badges.ts --dry-run      # resolve, do not write
 */

import { Client, GatewayIntentBits } from "discord.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import {
  defaultStoreConfig,
  listBadgeDefinitions,
  manifestEntryUrl,
  readManifest,
  renderBadgeSvg,
  resolveBadge,
  upsertManifestEntry,
  writeBadgeSvg,
  writeManifest,
} from "../src/features/badges/index.js";
import {
  loadSnapshot,
  resolveFromSnapshot,
} from "../src/features/badges/snapshotResolve.js";

type Args = {
  list: boolean;
  dryRun: boolean;
  id?: string;
  fromSnapshot: boolean;
  outDir?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { list: false, dryRun: false, fromSnapshot: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--list") args.list = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--from-snapshot") args.fromSnapshot = true;
    else if (a === "--id") args.id = argv[++i];
    else if (a.startsWith("--id=")) args.id = a.slice("--id=".length);
    else if (a === "--out-dir") args.outDir = argv[++i];
    else if (a.startsWith("--out-dir=")) args.outDir = a.slice("--out-dir=".length);
  }
  return args;
}

const REPO_BADGE_DIR = path.join("docs", "badges", "svg");
const ROLES_SNAPSHOT = path.join("docs", "internal-info", "ROLES.md");
const CHANNELS_SNAPSHOT = path.join("docs", "internal-info", "CHANNELS.md");

const RAW_PREFIX =
  process.env.BADGE_RAW_URL_PREFIX ??
  "https://raw.githubusercontent.com/watchthelight/pawtropolis-tech/main/docs/badges/svg";

function repoUrl(id: string, version?: string): string {
  const base = `${RAW_PREFIX.replace(/\/+$/, "")}/${id}.svg`;
  return version ? `${base}?v=${version}` : base;
}

function sha8(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 8);
}

function purgeJsdelivr(id: string): Promise<void> {
  return new Promise((resolve) => {
    const url = `https://purge.jsdelivr.net/gh/watchthelight/pawtropolis-tech@main/docs/badges/svg/${id}.svg`;
    https
      .get(url, (res) => {
        res.resume();
        res.on("end", resolve);
      })
      .on("error", () => resolve());
  });
}

/**
 * After SVG regen, walk every checked-in markdown file and update the
 * ?v=<old> query string for each badge URL to the new SHA8 of the badge
 * file. Lets us commit a fresh ?v= alongside the SVG so GitHub Camo and
 * jsdelivr can never serve a stale image without a corresponding doc edit.
 */
function updateDocUrls(badgeVersions: Map<string, string>): number {
  const docDirs = ["docs", "."];
  const visited = new Set<string>();
  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (
          ent.name === "node_modules" ||
          ent.name === "dist" ||
          ent.name === ".git" ||
          ent.name === "data" ||
          ent.name.startsWith("_bmad")
        )
          continue;
        out.push(...walk(full));
      } else if (ent.isFile() && ent.name.toLowerCase().endsWith(".md")) {
        out.push(full);
      }
    }
    return out;
  }
  let edited = 0;
  for (const d of docDirs) {
    if (!fs.existsSync(d)) continue;
    for (const file of walk(d)) {
      if (visited.has(file)) continue;
      visited.add(file);
      const before = fs.readFileSync(file, "utf8");
      const after = before.replace(
        /(?:cdn\.jsdelivr\.net\/gh\/watchthelight\/pawtropolis-tech@main|raw\.githubusercontent\.com\/watchthelight\/pawtropolis-tech\/main)(\/docs\/badges\/svg\/([a-z0-9_-]+)\.svg)(\?v=[a-zA-Z0-9_-]+)?/g,
        (_match, tail, id) => {
          const v = badgeVersions.get(id);
          const base = `raw.githubusercontent.com/watchthelight/pawtropolis-tech/main${tail}`;
          return v ? `${base}?v=${v}` : base;
        },
      );
      if (after !== before) {
        fs.writeFileSync(file, after, "utf8");
        edited += 1;
      }
    }
  }
  return edited;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const baseConfig = defaultStoreConfig();
  const config = args.fromSnapshot
    ? {
        ...baseConfig,
        generatedDir: args.outDir ?? REPO_BADGE_DIR,
        manifestPath:
          args.outDir != null
            ? path.join(args.outDir, "..", "manifest.json")
            : path.join("docs", "badges", "manifest.json"),
        baseUrl: RAW_PREFIX.replace(/\/badges\/svg\/?$/, "").replace(/\/+$/, ""),
      }
    : baseConfig;
  const defs = listBadgeDefinitions().filter((d) => !args.id || d.id === args.id);

  if (args.list) {
    for (const d of defs) {
      console.log(`${d.id.padEnd(32)} ${d.kind.padEnd(7)} ${d.discordId ?? ""}`);
    }
    return;
  }

  if (args.fromSnapshot) {
    const guildId = process.env.GUILD_ID || "snapshot";
    const snapshot = loadSnapshot(ROLES_SNAPSHOT, CHANNELS_SNAPSHOT);
    let manifest = readManifest(config);
    let resolved = 0;
    let stale = 0;
    const badgeVersions = new Map<string, string>();
    for (const def of defs) {
      const result = resolveFromSnapshot(def, snapshot, guildId);
      const svg = renderBadgeSvg({
        ...result,
        // url is filled in below once we know the version hash
      } as never);
      const version = sha8(svg);
      badgeVersions.set(def.id, version);
      const entry = {
        ...result,
        style: def.style,
        url: repoUrl(def.id, version),
        generatedAt: new Date().toISOString(),
      };
      if (!args.dryRun) writeBadgeSvg(config, def.id, svg);
      manifest = upsertManifestEntry(manifest, entry);
      if (result.stale) stale += 1;
      else resolved += 1;
      console.log(
        `${result.stale ? "STALE" : "OK   "} ${def.id.padEnd(32)} v=${version} -> ${result.displayName}`,
      );
    }
    if (!args.dryRun) writeManifest(config, manifest);
    let docEdits = 0;
    if (!args.dryRun) {
      docEdits = updateDocUrls(badgeVersions);
      console.log(`docs updated: ${docEdits} markdown files`);
      // Best-effort jsdelivr purge so the next request gets the fresh SVG.
      console.log("purging jsdelivr cache...");
      await Promise.all([...badgeVersions.keys()].map(purgeJsdelivr));
    }
    console.log(`\nresolved=${resolved} stale=${stale} dryRun=${args.dryRun} mode=snapshot`);
    return;
  }

  const token = process.env.DISCORD_TOKEN;
  const guildId = process.env.GUILD_ID;
  if (!token || !guildId) {
    console.error("DISCORD_TOKEN and GUILD_ID required (or pass --from-snapshot)");
    process.exit(1);
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(token);
  await new Promise<void>((resolve) => client.once("ready", () => resolve()));

  let manifest = readManifest(config);
  let resolved = 0;
  let stale = 0;
  for (const def of defs) {
    const prior = manifest.entries[def.id];
    const result = await resolveBadge(def, { client, guildId, prior });
    const entry = {
      ...result,
      style: def.style,
      url: manifestEntryUrl(config, def.id),
      generatedAt: new Date().toISOString(),
    };
    const svg = renderBadgeSvg(entry);
    if (!args.dryRun) {
      writeBadgeSvg(config, def.id, svg);
    }
    manifest = upsertManifestEntry(manifest, entry);
    if (result.stale) stale += 1;
    else resolved += 1;
    console.log(
      `${result.stale ? "STALE" : "OK   "} ${def.id.padEnd(28)} -> ${result.displayName}`,
    );
  }
  if (!args.dryRun) writeManifest(config, manifest);
  console.log(`\nresolved=${resolved} stale=${stale} dryRun=${args.dryRun}`);
  await client.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
