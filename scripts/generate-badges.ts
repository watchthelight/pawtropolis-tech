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
import path from "node:path";
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
    const a = argv[i];
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

function repoUrl(id: string): string {
  return `${RAW_PREFIX.replace(/\/+$/, "")}/${id}.svg`;
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
    for (const def of defs) {
      const result = resolveFromSnapshot(def, snapshot, guildId);
      const entry = {
        ...result,
        style: def.style,
        url: repoUrl(def.id),
        generatedAt: new Date().toISOString(),
      };
      const svg = renderBadgeSvg(entry);
      if (!args.dryRun) writeBadgeSvg(config, def.id, svg);
      manifest = upsertManifestEntry(manifest, entry);
      if (result.stale) stale += 1;
      else resolved += 1;
      console.log(
        `${result.stale ? "STALE" : "OK   "} ${def.id.padEnd(32)} -> ${result.displayName}`,
      );
    }
    if (!args.dryRun) writeManifest(config, manifest);
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
