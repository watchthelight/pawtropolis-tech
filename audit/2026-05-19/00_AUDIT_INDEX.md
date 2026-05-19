# Audit Index: 2026-05-19

Three-pass audit of pawtropolis-tech for code quality, security, and dependency/build/ops health. Each finding listed here is intended to become a tracked todo via the new issue system.

## Files

- [code-quality-findings.md](./code-quality-findings.md) - 27 findings (0 Critical, 7 High, 16 Medium, 4 Low, 0 Nominal)
- [security-findings.md](./security-findings.md) - 10 actionable findings (1 Critical, 5 High, 2 Medium, 2 Low). Plus 10 confirmed-resolved items from the January audit (no new todos needed).
- [deps-ops-findings.md](./deps-ops-findings.md) - 20 findings (0 Critical, 4 High, 7 Medium, 9 Low). 1 false positive corrected.

## Total

Approximately 51 unique findings will become todos after deduplication. Several security findings overlap with deps-ops findings on package vulnerabilities; the security file flags the exploit class, the deps-ops file tracks the package upgrade.

## Severity rollup (deduplicated count)

| Severity | Count | Notes |
|----------|-------|-------|
| Critical | 1 | npm audit HIGH/CRITICAL vulns (security #2 / deps #1-#3 merged) |
| High | 13 | 5 large-file refactors, web test coverage gap, vite dev vuln, outdated deps wave, Fastify upgrades (3), undici, lodash, minimatch |
| Medium | 21 | Disabled tests (3), missing feature tests (7), missing scheduler tests, lazy any (2), format drift, /listopen rate limit, CSRF check, lint backlog, format backlog, tsconfig hardening, cron failure alerts, deploy lock, PM2 kill_timeout, CI smoke test, pre-deploy backup |
| Low | 16 | Unused exports (5), TODO comments (2), ESLint env config, empty block, setDMPermission, badge CORS doc, stale .env backups, anthropic sdk removal, integration tests, SSH host validation, litestream validation, .env.example sync |

## Deduplication notes

- Security Finding 2 (CRITICAL npm vulns) consolidates with Deps Findings 1, 2, 3. One Critical todo will be created covering the full upgrade plan; subsequent todos for the individual fastify / undici / lodash / minimatch fixes if not bundled.
- Code Quality Finding 25 (eslint no-undef) overlaps with Deps Finding 5 (lint backlog). Single todo with both contexts.
- Code Quality Finding 17 (format drift) overlaps with Deps Finding 6 (format backlog). Single todo.
- Code Quality Finding 24 (TODO comment for JSON fallback) becomes its own todo (the comment refers to deferred work).

## False positive corrected

Deps-ops Finding 20: Agent claimed secrets committed to .env. Verified: .env is properly gitignored. Only .env.example tracked. No action needed.

## Resolved-since-January (confirmed in security audit, no todos needed)

- /stats export rate limit (STATS_EXPORT_MS)
- /poke rate limit (POKE_MS)
- /send rate limit (SEND_MS)
- secureCompare in resetdata, purge, database commands
- Session AES-256-GCM encryption
- OAuth2 state validation
- Server-side guild member + tier detection
- WelcomeMessageEditor HTML escape
- DDL identifier validation (src/db/columnUtil.ts)
- All SQL parameterized

## Next phase

Phase 8 of the porting plan converts each unique finding into a todo/NNNNN.md file with the right Type, Priority, and Evidence link back to this audit folder.
