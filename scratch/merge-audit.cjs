const fs = require("fs");
const all = JSON.parse(fs.readFileSync("audit/2026-05-31/findings-all.json", "utf8"));
const gapWrap = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const gap = (gapWrap.result && gapWrap.result.findings) || [];
const merged = [...all, ...gap];

// Dedup: same file + near-identical normalized title -> keep highest severity, merge sources.
const sevRank = { critical: 4, high: 3, medium: 2, low: 1 };
const norm = (t) => (t || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).slice(0, 8).join(" ");
const byKey = new Map();
for (const f of merged) {
  const key = (f.file || "?") + "||" + norm(f.title);
  const prev = byKey.get(key);
  if (!prev) { byKey.set(key, { ...f, sources: [f.source] }); continue; }
  prev.sources.push(f.source);
  if ((sevRank[f.severity] || 0) > (sevRank[prev.severity] || 0)) {
    prev.severity = f.severity; prev.title = f.title; prev.detail = f.detail; prev.fix = f.fix;
  }
}
const deduped = [...byKey.values()];
deduped.forEach((f, i) => (f.id = "A" + String(i + 1).padStart(4, "0")));

const sev = {}, conf = {};
deduped.forEach((f) => { sev[f.severity] = (sev[f.severity] || 0) + 1; conf[f.confidence] = (conf[f.confidence] || 0) + 1; });
fs.writeFileSync("audit/2026-05-31/findings-master.json", JSON.stringify(deduped, null, 2));
console.log("merged=" + merged.length + " -> deduped=" + deduped.length);
console.log("bySeverity=" + JSON.stringify(sev));
console.log("byConfidence=" + JSON.stringify(conf));
const issueWorthy = deduped.filter((f) => f.severity === "critical" || f.severity === "high" || f.severity === "medium" || (f.severity === "low" && f.confidence === "high"));
console.log("issue-worthy (crit+high+medium + high-confidence low)=" + issueWorthy.length);
console.log("distinct files=" + new Set(deduped.map((f) => f.file)).size);
