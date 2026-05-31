const email = process.env.CLOUDFLARE_EMAIL;
const key = process.env.CLOUDFLARE_API_KEY;
const envZone = process.env.CLOUDFLARE_ZONE_ID;
if (!email || !key) { console.error("missing CF env"); process.exit(1); }
const h = { "X-Auth-Email": email, "X-Auth-Key": key, "Content-Type": "application/json" };
const api = "https://api.cloudflare.com/client/v4";
(async () => {
  // Resolve the real zone id for pawtropolis.tech
  const z = await (await fetch(api + "/zones?name=pawtropolis.tech", { headers: h })).json();
  if (!z.success || !z.result[0]) { console.error("zone lookup failed: " + JSON.stringify(z.errors || z)); process.exit(1); }
  const zoneId = z.result[0].id;
  console.log("pawtropolis.tech zoneId=" + zoneId + "  (env CLOUDFLARE_ZONE_ID " + (zoneId === envZone ? "MATCHES" : "DIFFERS -> env was wrong zone") + ")");
  const base = api + "/zones/" + zoneId + "/dns_records";
  // List every record named status.pawtropolis.tech, any type
  const recs = await (await fetch(base + "?name=status.pawtropolis.tech", { headers: h })).json();
  if (!recs.success) { console.error("records list failed: " + JSON.stringify(recs.errors)); process.exit(1); }
  if (!recs.result.length) { console.error("no status.pawtropolis.tech DNS record in zone (may be Cloudflare-for-SaaS custom hostname)"); process.exit(2); }
  for (const r of recs.result) console.log("  rec " + r.id + "  type=" + r.type + "  content=" + r.content + "  proxied=" + r.proxied);
  const target = recs.result.find((r) => r.proxied) || recs.result[0];
  if (target.proxied) {
    const p = await (await fetch(base + "/" + target.id, { method: "PATCH", headers: h, body: JSON.stringify({ proxied: false }) })).json();
    console.log("PATCH " + target.id + " success=" + p.success + (p.success ? "  proxied(after)=" + p.result.proxied : "  errors=" + JSON.stringify(p.errors)));
  } else {
    console.log("record already DNS-only; no change.");
  }
})();
