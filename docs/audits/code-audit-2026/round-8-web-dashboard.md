# Round 8: Web Dashboard (P1) — Audit Report

Audited: 2026-03-05
Files: 26 | Total Lines: ~6,200

## Files Reviewed

| File | Lines | Era | Commits | Test File |
|------|-------|-----|---------|-----------|
| `web/src/lib/server/queries/stats.ts` | 541 | Dashboard Era | 3 | None |
| `web/src/lib/server/queries/reviews.ts` | 293 | Dashboard Era | 13 | None |
| `web/src/lib/server/queries/flags.ts` | 152 | Dashboard Era | 1 | None |
| `web/src/lib/server/queries/modmail.ts` | 94 | Dashboard Era | 1 | None |
| `web/src/lib/server/queries/home.ts` | 61 | Dashboard Era | 4 | None |
| `web/src/lib/server/db.ts` | 23 | Dashboard Era | 2 | None |
| `web/src/lib/server/roles.ts` | 89 | Dashboard Era | 2 | None |
| `web/src/lib/server/session.ts` | 51 | Dashboard Era | 1 | None |
| `web/src/lib/server/discord.ts` | 87 | Dashboard Era | 1 | None |
| `web/src/lib/server/botApi.ts` | 75 | Dashboard Era | 2 | None |
| `web/src/lib/server/events/bus.ts` | 46 | Dashboard Era | 3 | None |
| `web/src/lib/server/events/fan-out.ts` | 119 | Dashboard Era | 3 | None |
| `web/src/lib/stores/theme.ts` | 228 | Dashboard Era | 11 | None |
| `web/src/lib/stores/sse.svelte.ts` | 179 | Dashboard Era | 3 | None |
| `web/src/lib/stores/bot-status.svelte.ts` | 61 | Dashboard Era | 3 | None |
| `web/src/lib/types/events.ts` | 174 | Dashboard Era | 5 | None |
| `web/src/routes/dashboard/flags/+page.svelte` | 923 | Dashboard Era | 7 | None |
| `web/src/routes/dashboard/reviews/+layout.svelte` | 443 | Dashboard Era | 15 | None |
| `web/src/routes/dashboard/stats/+page.svelte` | 604 | Dashboard Era | 7 | None |
| `web/src/routes/dashboard/+layout.svelte` | 378 | Dashboard Era | 16 | None |
| `web/src/routes/+page.svelte` | 445 | Dashboard Era | 13 | None |
| `web/src/routes/api/review/[action]/+server.ts` | 68 | Dashboard Era | 4 | None |
| `web/src/routes/api/review/profile/+server.ts` | 68 | Dashboard Era | 5 | None |
| `web/src/routes/api/flag/dismiss/+server.ts` | 55 | Dashboard Era | 0 | None |
| `web/src/routes/api/sse/+server.ts` | 71 | Dashboard Era | 1 | None |
| `web/src/routes/auth/callback/+server.ts` | 69 | Dashboard Era | 2 | None |

---

## Overall Assessment

The web dashboard is the newest code (all Dashboard Era, ~1 week old) and is impressively well-built:
- **Security**: Proper auth on all API routes, UUID validation, tier-based permissions, input sanitization, shared secret for bot API communication, no `{@html}` XSS vectors
- **Database**: Read-only `query_only = ON` pragma, parameterized SQL everywhere, lazy-initialized connection
- **Architecture**: Clean separation (server queries, client stores, API routes, bot API bridge)
- **Real-time**: Tier-filtered SSE with heartbeat keep-alive

The main security concern is **unencrypted session cookies** containing OAuth tokens.

---

## Findings

### F072 — Session cookies store OAuth tokens in plaintext JSON
- **File**: `web/src/lib/server/session.ts:28-35`
- **Severity**: HIGH
- **Category**: Security
- **Description**: The session cookie stores `accessToken`, `refreshToken`, and `expiresAt` as plain JSON in an httpOnly cookie. The JSDoc comment says "Sessions are signed with SESSION_SECRET" but the code uses no signing or encryption — it's just `JSON.stringify(data)` with `cookies.set()`.

  While httpOnly + secure + sameSite=lax provides good browser-side protection, the token is visible:
  1. In browser devtools (Application > Cookies) — visible to anyone with physical access
  2. To any server-side code that reads the cookie (e.g., a hypothetical SSRF or middleware injection)
  3. In server access logs if cookie logging is enabled

  The `accessToken` grants access to the user's Discord data (guilds.join scope).
- **Risk**: Medium-high. An attacker with cookie access could impersonate the user on Discord. The httpOnly flag prevents JS access, but the token is still plain text.
- **Fix**: Either encrypt the cookie value (using `crypto.createCipheriv` with a server secret) or use SvelteKit's built-in cookie signing (pass `secrets` option to `cookies.set`). Alternatively, store tokens server-side (e.g., in SQLite keyed by session ID) and only put a session ID in the cookie.

### F073 — `console.log` usage in web server code
- **File**: `web/src/lib/server/events/fan-out.ts:42,49,111` and `web/src/routes/auth/callback/+server.ts:66`
- **Severity**: LOW
- **Category**: Pattern Consistency
- **Description**: The web dashboard uses `console.log`/`console.error` instead of a structured logger. The bot uses pino. For the dashboard, console.log is arguably fine since PM2 captures stdout anyway, but it lacks structured fields for filtering/searching.
- **Fix**: Low priority. Could add a lightweight logger but console is adequate for the dashboard's simpler logging needs.

### F074 — `(data as any).queue` in reviews detail page
- **File**: `web/src/routes/dashboard/reviews/[appId]/+page.svelte:17`
- **Severity**: LOW
- **Category**: Type Safety
- **Description**: The `queue` property comes from the parent layout's data, not the page's own server load. SvelteKit's `$types` only types the page's own load data. The `as any` cast is the standard workaround for accessing parent layout data in typed Svelte 5.
- **Fix**: Could use `$page.data.queue` with proper typing, or declare the queue type in the page's types. Low priority.

### F075 — `GUILD_ID = process.env.GUILD_ID!` non-null assertions
- **File**: `web/src/routes/auth/callback/+server.ts:7`, `web/src/routes/dashboard/reviews/[appId]/+page.server.ts:7`, and multiple other server files
- **Severity**: LOW
- **Category**: Type Safety
- **Description**: Multiple files use `process.env.GUILD_ID!` (non-null assertion) without validation. If GUILD_ID is not set, this will be `undefined` at runtime causing subtle bugs in SQL queries (WHERE guild_id = undefined).
- **Risk**: Low — the bot validates GUILD_ID at startup, and the dashboard runs on the same server. But the web app has no independent env validation.
- **Fix**: Add a simple env validation in the web app (e.g., a shared `getGuildId()` that throws if missing). Or validate in hooks.server.ts at startup.

### F076 — No test coverage for entire web dashboard
- **File**: All web/src/ files
- **Severity**: MED
- **Category**: Test Coverage
- **Description**: 26 files, ~6,200 lines, zero test files. The dashboard handles authentication, authorization, real-time events, database queries, and bot API communication. The API routes have proper input validation that would benefit from unit tests.
- **Fix**: Defer — newest code, architecture is clean, manual testing via MCP tools (Playwright, Chrome DevTools) is available. Priority should be API route tests for auth/validation logic.

### F077 — flags/+page.svelte is 923 lines
- **File**: `web/src/routes/dashboard/flags/+page.svelte`
- **Severity**: LOW
- **Category**: Pattern
- **Description**: The flags page handles search, sort, filter, three view modes (list/compact/icon), expandable details, avatar lightbox, dismiss functionality, and styling — all in one file. Could be split into smaller components.
- **Fix**: Low priority — Svelte's single-file component model means large pages are common. The logic is well-organized with clear sections.

### F078 — `process.env.OAUTH2_REDIRECT_URI!` used in callback
- **File**: `web/src/routes/auth/callback/+server.ts:24`
- **Severity**: LOW
- **Category**: Type Safety
- **Description**: Non-null assertion on `OAUTH2_REDIRECT_URI` env var. If missing, the OAuth2 exchange will fail with an opaque error.
- **Fix**: Part of F075 — add web-side env validation.

### F079 — SSE client registry has no max client limit
- **File**: `web/src/lib/server/events/fan-out.ts:32`
- **Severity**: LOW
- **Category**: Security / Performance
- **Description**: `const clients = new Map<string, SSEClient>()` has no upper bound. A malicious user could open hundreds of SSE connections to exhaust server memory.
- **Risk**: Low — authentication is required, and Cloudflare/Nginx rate limiting provides defense in depth.
- **Fix**: Add `MAX_CLIENTS = 100` check in `addClient()` that rejects new connections when at capacity.

---

## TODO List (for improvement pass)

### High Priority
- [x] F072: Encrypt session cookies with AES-256-GCM

### Quick Fixes (< 5 min each)
- [x] F075: Add env validation via web/src/lib/server/env.ts
- [x] F079: Add MAX_CLIENTS=200 limit to SSE fan-out

### Deferred
- [ ] F073: Add structured logging to web dashboard
- [ ] F074: Type parent layout data properly in review detail page
- [ ] F076: Test coverage for web dashboard API routes
- [ ] F077: Split flags page into smaller components

### Cross-Reference Warnings
- F072 cookie encryption must not break existing sessions — either version the cookie format or force re-login on deploy
- F075 env validation should happen once at startup, not per-request
- F079 client limit must account for users with multiple tabs (same userId, different clientIds)
