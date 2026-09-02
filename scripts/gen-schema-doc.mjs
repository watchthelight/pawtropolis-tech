#!/usr/bin/env node
// Regenerates docs/reference/database-schema.md from tests/fixtures/schema.sql.
// Usage: node scripts/gen-schema-doc.mjs   (npm run docs:schema)
import fs from "node:fs";

const SCHEMA = "tests/fixtures/schema.sql";
const OUT = "docs/reference/database-schema.md";

// Rows the bot removes on its own; everything else is kept indefinitely.
const RETENTION = {
  security_issue_history: "rows older than 90 days (retention scheduler, RETENTION_ENABLED=true)",
  consumed_confirmations: "rows older than 1 day (retention scheduler)",
  config_audit_log: "rows older than 365 days (retention scheduler)",
  member_role_snapshots: "restored snapshots older than 180 days (retention scheduler)",
  message_activity: "rows older than 90 days (messageActivityPrune scheduler, daily)",
  action_log_fts: "external-content index over action_log, rebuilt hourly for new rows",
};

const sql = fs.readFileSync(SCHEMA, "utf8");
const tables = [];
const tableRe = /CREATE TABLE IF NOT EXISTS\s+"?([A-Za-z0-9_]+)"?\s*\(([\s\S]*?)\)\s*(?:WITHOUT ROWID)?\s*;/g;
const CONSTRAINT = /^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)\b/i;
for (const m of sql.matchAll(tableRe)) {
  const name = m[1];
  const body = m[2];
  const columns = [];
  // Column definitions are separated by commas at depth 0.
  let depth = 0;
  let current = "";
  const parts = [];
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  for (const raw of parts) {
    const def = raw.replace(/--.*$/gm, "").trim().replace(/\s+/g, " ");
    if (!def || CONSTRAINT.test(def)) continue;
    const [col, ...rest] = def.replace(/^"([^"]+)"/, "$1").split(" ");
    const type = rest.find((t) => /^(TEXT|INTEGER|REAL|BLOB|NUMERIC|BOOLEAN|DATETIME|TIMESTAMP)$/i.test(t)) ?? "";
    const flags = [];
    if (/PRIMARY KEY/i.test(def)) flags.push("pk");
    if (/NOT NULL/i.test(def)) flags.push("not null");
    if (/UNIQUE/i.test(def) && !/PRIMARY KEY/i.test(def)) flags.push("unique");
    columns.push({ col, type: type.toUpperCase(), flags });
  }
  tables.push({ name, columns });
}
tables.sort((a, b) => a.name.localeCompare(b.name));

const indexes = {};
for (const m of sql.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS\s+([A-Za-z0-9_]+)\s+ON\s+"?([A-Za-z0-9_]+)"?/g)) {
  (indexes[m[2]] ??= []).push(m[1]);
}
const virtual = [...sql.matchAll(/CREATE VIRTUAL TABLE IF NOT EXISTS\s+([A-Za-z0-9_]+)\s+USING\s+(\w+)/g)].map((m) => ({
  name: m[1],
  using: m[2],
}));

const lines = [];
lines.push("# Database Schema");
lines.push("");
lines.push(
  "Generated from `tests/fixtures/schema.sql` by `scripts/gen-schema-doc.mjs` (`npm run docs:schema`). Do not edit by hand; regenerate after a migration and commit both files."
);
lines.push("");
lines.push(
  "SQLite in WAL mode at `DB_PATH` (default `data/data.db`). Discord ids are TEXT snowflakes. Timestamps are either ISO 8601 TEXT (`*_at`) or Unix seconds INTEGER (`*_at_s`, `*_ts`), as named. The bot opens the file with a 64 MB page cache, a 256 MB memory map and a 64 MB WAL cap; the dashboard opens the same file read-mostly."
);
lines.push("");
lines.push(`${tables.length} tables, ${virtual.length} virtual tables, ${Object.values(indexes).flat().length} indexes.`);
lines.push("");
lines.push("## Retention");
lines.push("");
lines.push("| Table | Removed automatically |");
lines.push("|---|---|");
for (const [t, rule] of Object.entries(RETENTION)) lines.push(`| \`${t}\` | ${rule} |`);
lines.push("");
lines.push(
  "Everything else is kept. `messages_archive` (the full message backfill) is deliberately unbounded. Deploy backups in `data/backups` are pruned to the 3 newest plus 7 days by the same retention scheduler."
);
lines.push("");
lines.push("## Tables");
lines.push("");
for (const t of tables) {
  lines.push(`### ${t.name}`);
  lines.push("");
  if (RETENTION[t.name]) lines.push(`Retention: ${RETENTION[t.name]}.`), lines.push("");
  lines.push("| Column | Type | Notes |");
  lines.push("|---|---|---|");
  for (const c of t.columns) lines.push(`| \`${c.col}\` | ${c.type || " "} | ${c.flags.join(", ")} |`);
  if (indexes[t.name]) {
    lines.push("");
    lines.push(`Indexes: ${indexes[t.name].map((i) => `\`${i}\``).join(", ")}`);
  }
  lines.push("");
}
if (virtual.length) {
  lines.push("## Virtual tables");
  lines.push("");
  for (const v of virtual) lines.push(`- \`${v.name}\` (${v.using})${RETENTION[v.name] ? `: ${RETENTION[v.name]}` : ""}`);
  lines.push("");
}
fs.writeFileSync(OUT, lines.join("\n"));
console.log(`wrote ${OUT}: ${tables.length} tables`);
