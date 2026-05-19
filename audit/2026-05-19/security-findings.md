# Security Findings (2026-05-19)

## Executive Summary

Application logic shows strong security baseline: parameterized SQL queries, rate limiting on most expensive operations, encrypted session cookies (AES-256-GCM), OAuth2 state validation, server-side role enforcement, constant-time password comparison, HTML escaping in Svelte templates. Two areas need attention: unaddressed HIGH/CRITICAL dependency vulnerabilities (covered also in deps-ops-findings.md), and a missing CSRF check on the dashboard API.

---

## Finding 1: Missing rate limit on /listopen command
- Severity: Medium
- File(s): src/commands/listopen.ts:92-150
- Evidence: Staff-only command with LRU cache (1-minute TTL) but no checkCooldown guard. A compromised moderator account or spam could hammer the db.
- Proposed action: Add checkCooldown("listopen", interaction.guildId, 60 * 1000) at start of execute.
- CWE: CWE-770 (Allocation of Resources Without Limits)

## Finding 2: HIGH and CRITICAL npm vulnerabilities unpatched
- Severity: Critical
- File(s): package.json dependencies (see deps-ops-findings.md for full table)
- Evidence: npm audit --production reports CRITICAL protobufjs (RCE), HIGH fastify (validation bypass + X-Forwarded spoofing), HIGH jws (HMAC bypass), HIGH lodash (prototype pollution / code injection), HIGH minimatch (ReDoS), HIGH fast-uri (path traversal), HIGH undici (HTTP smuggling).
- Proposed action: Run npm audit fix. Upgrade fastify >=5.8.5, undici >=6.24.0, lodash >=4.17.24, minimatch >=9.0.7. For protobufjs: audit @xenova/transformers usage; if unused, remove entirely (see deps-ops Finding 5).
- CWE: CWE-94 (Code Injection), CWE-347 (HMAC bypass), CWE-1321 (Prototype Pollution), CWE-1333 (ReDoS), CWE-22 (Path Traversal), CWE-444 (HTTP Smuggling)

## Finding 3: Missing setDMPermission(false) on guild-only commands
- Severity: Low
- File(s): src/commands/roles.ts, src/commands/flag.ts, src/commands/art.ts, src/commands/artistqueue.ts, others
- Evidence: Discord still shows commands in DMs even though runtime checks deny execution. UX confusion plus signal of incomplete hardening.
- Proposed action: Add .setDMPermission(false) to every guild-only SlashCommandBuilder. Cross-reference src/lib/config.ts requireMinRole / requireGatekeeper callers.
- CWE: CWE-668

## Finding 4: Fastify content-type validation bypass
- Severity: High
- File(s): src/web/dashboardApi.ts:75-89 (Fastify init)
- Evidence: Fastify <=5.8.4 (GHSA-247c-9743-5963) allows schema-bypass via leading space in Content-Type header. Dashboard validates body schemas; attacker could bypass by crafting an unusual content-type.
- Proposed action: Upgrade fastify to >=5.8.5. No code changes needed.
- CWE: CWE-1287

## Finding 5: undici HTTP/WebSocket smuggling and decompression
- Severity: High
- File(s): node_modules/undici (transitive via discord.js)
- Evidence: undici <=6.23.0 has request smuggling, unbounded decompression, WebSocket overflows, CRLF injection in upgrade option.
- Proposed action: Upgrade discord.js to latest patch (pulls non-vulnerable undici) or pin undici >=6.24.0 in overrides.
- CWE: CWE-444, CWE-400

## Finding 6: lodash code injection via _.template
- Severity: High
- File(s): node_modules/lodash (transitive)
- Evidence: lodash <=4.17.23 allows arbitrary code via _.template imports. Impact depends on usage; check if user input flows into lodash compilation in badge SVG generation.
- Proposed action: npm ls lodash to identify consumers. If used in user-facing rendering (src/features/badges/), upgrade to >=4.17.24 or sanitize inputs.
- CWE: CWE-94

## Finding 7: Fastify X-Forwarded-Proto/Host spoofing
- Severity: High
- File(s): src/web/dashboardApi.ts (Fastify instance)
- Evidence: Fastify <=5.8.2 trusts X-Forwarded-Proto/Host from any source. If dashboard is exposed without trustProxy correctly set, attacker spoofs request.protocol/host, bypassing CSRF token or host checks.
- Proposed action: Upgrade fastify >=5.8.3. Verify trustProxy: set to allowlist of trusted proxy IPs.
- CWE: CWE-348

## Finding 8: minimatch ReDoS
- Severity: High
- File(s): node_modules/minimatch (transitive)
- Evidence: minimatch 9.0.0-9.0.6 has ReDoS in matchOne with repeated wildcards / nested GLOBSTAR. Mostly affects dev/build tooling.
- Proposed action: Upgrade minimatch >=9.0.7. Library fix only.
- CWE: CWE-1333

## Finding 9: Dashboard API lacks Origin header CSRF check
- Severity: Medium
- File(s): src/web/dashboardApi.ts:77-83, web/src/lib/server/botApi.ts
- Evidence: X-Dashboard-Secret header authenticates requests but does not provide CSRF protection. State-changing routes (approve/reject) accessible from any origin if browser carries the cookie. SvelteKit form CSRF tokens not used.
- Proposed action: Add Origin header validation to dashboardApi.ts: check request.headers.origin matches the configured dashboard origin for state-changing routes.
- CWE: CWE-352

## Finding 10: Badge endpoint CORS allows any origin (intentional)
- Severity: Low
- File(s): src/web/badgeEndpoint.ts:45-54, src/web/statusEndpoint.ts
- Evidence: Access-Control-Allow-Origin: * for badge SVGs. Intentional for public embedding in markdown / GitHub profiles. Read-only, no secrets.
- Proposed action: No change; keep endpoints read-only. Document intent inline.

## Note: confirmed-resolved findings from January 2026 audit

- /stats export has STATS_EXPORT_MS cooldown (rateLimiter.ts:187) - RESOLVED
- /poke has POKE_MS cooldown (rateLimiter.ts:185) - RESOLVED
- /send has SEND_MS cooldown - RESOLVED
- All password verification uses secureCompare (crypto.timingSafeEqual) - IN PLACE
- Session encryption with AES-256-GCM, httpOnly secure sameSite cookies - IN PLACE
- OAuth2 state token validated against secure 10-minute cookie - IN PLACE
- Server-side guild member + tier check at OAuth callback - IN PLACE
- WelcomeMessageEditor preview properly HTML-escapes user input - IN PLACE
- DDL identifier validation in src/db/columnUtil.ts:46-80 - IN PLACE
- All SQL queries use parameter binding (sample audit, no template-literal interpolation found) - IN PLACE
