#!/usr/bin/env node
/**
 * Surface 6 token codemod: rename the old Cozy Holdfast token vocabulary to the
 * Sage Observatory vocabulary across web/src components.
 *
 * Usage:
 *   node scripts/_codemod-tokens.cjs <dir>            # dry run (report only)
 *   node scripts/_codemod-tokens.cjs <dir> --write    # apply
 *
 * Each token is matched as (?<![\w-])--tok(?![\w-]) so that --accent never
 * matches --accent-dim / --accent-hex, and --border never matches
 * --border-holdfast. Replacement targets are never themselves sources, so the
 * pass is order-independent and idempotent.
 *
 * Excludes app.css (hand-maintained theme defs + alias block) and lib/styles/*
 * (the Win95 observatory.css and the doomed neumorphism/glass/skeuo files).
 */
const fs = require("fs");
const path = require("path");

const PAIRS = [
  ["--accent-glow-bg", "--sage-fill"],
  ["--accent-strong", "--sage-bright"],
  ["--accent-muted", "--sage-muted"],
  ["--accent-soft", "--sage-soft"],
  ["--accent-dim", "--sage-deep"],
  ["--accent", "--sage"],
  ["--surface-raised", "--surface-2"],
  ["--surface-overlay", "--surface-3"],
  ["--border-holdfast", "--line"],
  ["--border-strong", "--line-strong"],
  ["--border", "--line-soft"],
  ["--text-on-accent", "--on-sage"],
  ["--text-primary", "--ink"],
  ["--text-secondary", "--ink-2"],
  ["--text-tertiary", "--ink-3"],
  ["--text-muted", "--ink-faint"],
  ["--status-success", "--good"],
  ["--status-warning", "--warn"],
  ["--status-danger", "--danger"],
  ["--status-info", "--info"],
  ["--bg", "--void"],
];

const EXTS = new Set([".svelte", ".css", ".ts"]);

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const COMPILED = PAIRS.map(([from, to]) => ({
  from,
  to,
  re: new RegExp("(?<![\\w-])" + escapeRe(from) + "(?![\\w-])", "g"),
}));

function excluded(p) {
  const n = p.replace(/\\/g, "/");
  if (n.endsWith("/app.css")) return true;
  if (n.includes("/lib/styles/")) return true;
  return false;
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".svelte-kit") continue;
      walk(full, out);
    } else if (EXTS.has(path.extname(entry.name)) && !excluded(full)) {
      out.push(full);
    }
  }
}

const args = process.argv.slice(2);
const write = args.includes("--write");
const target = args.find((a) => !a.startsWith("--"));
if (!target) {
  console.error("usage: node scripts/_codemod-tokens.cjs <dir> [--write]");
  process.exit(1);
}

const files = [];
const stat = fs.statSync(target);
if (stat.isDirectory()) walk(target, files);
else files.push(target);

const tokenTotals = Object.fromEntries(PAIRS.map(([f]) => [f, 0]));
let changedFiles = 0;
let totalReplacements = 0;
const perFile = [];

for (const file of files) {
  let content = fs.readFileSync(file, "utf8");
  const original = content;
  let fileCount = 0;
  for (const { from, to, re } of COMPILED) {
    content = content.replace(re, () => {
      fileCount++;
      tokenTotals[from]++;
      return to;
    });
  }
  if (fileCount > 0) {
    changedFiles++;
    totalReplacements += fileCount;
    perFile.push([file, fileCount]);
    if (write) fs.writeFileSync(file, content);
  }
  void original;
}

perFile.sort((a, b) => b[1] - a[1]);
console.log(`${write ? "APPLIED" : "DRY RUN"}  target=${target}`);
console.log(`files scanned: ${files.length}  files changed: ${changedFiles}  replacements: ${totalReplacements}\n`);
console.log("per token:");
for (const [from, to] of PAIRS) {
  if (tokenTotals[from]) console.log(`  ${from.padEnd(20)} -> ${to.padEnd(16)} ${tokenTotals[from]}`);
}
console.log("\nper file:");
for (const [file, n] of perFile) console.log(`  ${String(n).padStart(4)}  ${file.replace(/\\/g, "/")}`);
