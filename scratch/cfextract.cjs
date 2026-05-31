const fs = require("fs");
const target = process.argv[2];
const credPath = process.argv[3];
const cred = fs.readFileSync(credPath, "utf8");
const start = cred.indexOf("## Cloudflare");
if (start < 0) { console.error("Cloudflare section not found"); process.exit(1); }
let end = cred.indexOf("\n## ", start + 5);
if (end < 0) end = cred.length;
const sec = cred.slice(start, end);
const want = {
  "Email": "CLOUDFLARE_EMAIL",
  "Global API key": "CLOUDFLARE_API_KEY",
  "Zone ID": "CLOUDFLARE_ZONE_ID",
  "Account ID": "CLOUDFLARE_ACCOUNT_ID",
};
const vals = {};
for (const line of sec.split("\n")) {
  if (!line.includes("|")) continue;
  const cells = line.split("|").map((c) => c.trim());
  if (cells.length < 3) continue;
  const field = cells[1].replace(/\*/g, "").trim();
  const value = cells[2].replace(/`/g, "").trim();
  if (want[field] && value && !vals[want[field]]) vals[want[field]] = value;
}
let cur = "";
try { cur = fs.readFileSync(target, "utf8"); } catch (e) {}
if (/CLOUDFLARE_API_KEY=/.test(cur)) { console.log("ALREADY PRESENT in " + target + "; left untouched."); process.exit(0); }
const keys = Object.values(want);
const block =
  "\n# Cloudflare (copied from ~/blue-walmart/credentials.md on 2026-05-31; gitignored; for DNS/API automation)\n" +
  "# NOTE: GLOBAL API key = full account access. Prefer a scoped DNS-edit token; rotate if leaked.\n" +
  keys.map((k) => k + "=" + (vals[k] || "")).join("\n") + "\n";
fs.appendFileSync(target, block);
console.log("Wrote " + keys.length + " keys to " + target + " (values hidden):");
keys.forEach((k) => console.log("  " + k + " = [" + ((vals[k] || "").length) + " chars]" + (vals[k] ? "" : " <MISSING>")));
