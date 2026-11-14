# Pawtropolis Tech v26: modernization plan

Written 2026-11-14 on branch `release/v26` (cut from `main` at `821f8491`). This file is the audit result and the work order for the v26 release. It is updated as work lands: every item ends up as done, deferred (with the reason), or waiting on an owner decision.

Tracking todos: #00279 (`/investigate-artist`), #00280 (security), #00281 (reliability), #00282 (dependencies and runtime), #00283 (CI, lint, format, coverage), #00284 (measured optimizations), #00285 (release 26.0.0), #00286 (deferred to the next release), #00287 (owner decisions).

## 1. What this repo is

A single-developer Discord bot for one server (Pawtropolis, about 9,100 members) plus a SvelteKit staff dashboard.

- **Bot** (`src/`): TypeScript strict, ESM, discord.js 14, better-sqlite3 in WAL mode, Fastify for a small internal API, pino logging, Sentry, zod for env parsing. Built with tsup into `dist/index.js`. Features: join gate and application review, modmail, tickets, artist queue and rewards, levels, movie and game night attendance, AI image detection (`/isitreal`), message activity stats, badges, ops health checks, retention and backup jobs.
- **Dashboard** (`web/`): SvelteKit with its own `package.json` and lockfile. Reads the same SQLite file directly and calls the bot's internal API on port 3003 with a shared secret.
- **Worker** (`workers/discord-proxy`): a Cloudflare Worker used as a Discord profile proxy.
- **Run and deploy**: PM2 on one EC2 host (`ecosystem.config.cjs`: `pawtropolis` runs `dist/index.js`, `pawtropolis-web` runs `web/build/index.js`). `./deploy.sh` builds, uploads, runs `npm ci --omit=dev` on the host, runs migrations, restarts. Slash commands are registered with `npm run deploy:cmds` on the host.
- **External services**: Discord (gateway, REST, OAuth, linked roles), Sentry, Google Cloud Vision, Hive, SightEngine, Optic and RapidAPI detectors (AI image detection), GitHub (a bot token pushes banner and audit doc commits), Cloudflare (proxy worker, badge hosting), web push (VAPID), an optional Redis cache backend, and now the Claude API plus reverse image search services for `/investigate-artist`.

### Things I had to infer

- **Production still uses the third-party Ticket Tool bot for tickets.** The repo has a first-party ticket system (migrations 067 and 068, `src/features/tickets/`) and a cutover doc, but the live "Tickets" category only holds Ticket Tool channels (`2d-artist-0297` to `2d-artist-0309` on 2026-11-14), and the local copy of the `ticket` table is empty. `/investigate-artist` therefore supports both systems.
- **The production Node version is not recorded anywhere I can read** (repo docs say "Node 20+"). I did not SSH to the host to check: only read-only inspection through the bot was sanctioned. Node 20 went end of life on 2026-04-30.
- **No test guild is available.** `TEST_GUILD_ID` is empty and the bot is in exactly one guild (production). New commands could not be registered or tried in a test server.
- **The staff-side artist verification workflow is the "Commissions Verification" section of `docs/MOD-HANDBOOK.md`**, and the applicant-side requirements are the embed posted in the verify-artist channel, the ticket panel and the Ticket Tool greeting. A staff forum thread points staff at the handbook, which supports this reading.
- **The 15-minute public stats refresh may or may not be scheduled in production.** It is a script (`npm run stats:refresh`), and the crontab is on the host.

## 2. Baseline (before any change)

Measured in place on Windows, Node v25.5.0, npm 11.21.0, at `821f8491`.

| Gate | Result | Notes |
|---|---|---|
| Install (`npm ls`) | pass | |
| Typecheck (`tsc --noEmit`) | pass | Covers `src` and `scripts` only. Tests and migrations are not typechecked. |
| Build (`tsup`) | pass | `dist/index.js` 2.04 MB |
| Smoke (`node --check dist/index.js`) | pass | |
| Tests (`vitest run --coverage`) | pass | 289 files, 5744 tests, 33.8 s |
| Coverage | lines 47.71%, statements 47.32%, functions 50.52%, branches 41.94% | Overstated: 62 source files (about 13k lines) are never loaded, so they are not counted. |
| Lint (`eslint .`) | **fail** | 1441 problems: 1274 errors, 167 warnings. 1227 are `no-explicit-any`, about 1150 of them in tests. |
| Format (`prettier --check .`) | **fail** | 839 files |
| Dead code (`knip`) | **fail** | 2 unused files, 2 unused exports, 1 unused type, 12 config hints |
| `npm run check` | **fail** | Cannot pass while lint and format fail. |
| CI | green | Lint, format and knip are `continue-on-error`, so CI hides the three failures above. CI runs on Node 20 (end of life). The dashboard has no CI checks. |
| `npm audit` (root) | 4 high in fastify, 3 high in sharp, undici advisories through discord.js | |
| `npm audit` (web) | 1 critical (dompurify through mermaid), 1 high (devalue), 1 moderate (kit) | |

Pre-existing failures are findings HEALTH-1, HEALTH-3, HEALTH-20 and TCD-12 below. None are hidden by this branch: the goal is to make all gates pass for real and then make them hard gates.

**Secrets:** no secrets were found in the tracked tree or in git history. `.env`, `.env.build`, `.env.cloudflare`, `CREDENTIALS.md` and `finances.md` are gitignored, and the example files hold placeholders only.

## 3. Findings, ranked

Impact is what goes wrong today. Fix risk is the chance the fix itself breaks something. "v26" means it ships in this release.

### Tier 1: high impact, low fix risk (v26)

| ID | Finding | Impact | Fix risk | Plan |
|---|---|---|---|---|
| SEC-1 | Dashboard session cookie falls back to plain JSON when decryption fails (`web/src/lib/server/session.ts`). Anyone can forge a session, including an owner-tier one. | Critical | Low | Remove the fallback. Old plain cookies stop working; users sign in again. |
| SEC-2 | When `/update banner` or `/update avatar` fails to push, the git error (which contains the GitHub bot token in the remote URL) is shown in a public reply and logged. Same pattern in `src/features/serverAuditDocs.ts`. | High | Low | Keep the token out of argv and out of error text. |
| SEC-3 | Internal dashboard API listens on `0.0.0.0:3003` and compares its secret with `!==`. | High | Low to medium | Bind to `127.0.0.1` by default (`DASHBOARD_API_HOST` overrides), constant-time compare. Behavior change, see section 7. |
| DEP-1 | fastify 5.8.5: 4 high advisories. | High | Low | `^5.12.8` |
| DEP-2 | undici 6.28.0 through discord.js. | Medium | Low | discord.js 14.28.1, undici 6.29.1 |
| DEP-4 | sharp 0.34.5: 3 high advisories (root and web). | High | Low | `^0.35.5`. None of the removed options are used. |
| DEP-6 | Dashboard: dompurify critical through mermaid, devalue high, kit moderate. | High | Low | In-range updates in `web/`. |
| REL-1 | Panic mode is off after every restart until the full member fetch finishes (`src/startup/ready.ts`). | High | Low | Load panic state before the first await. |
| REL-2 | A modmail row stuck at `thread_id = 'pending'` blocks that applicant's modmail forever (`src/features/modmail/threadOpen.ts`). | High | Low | Expire stale pending rows. |
| REL-6 | Ticket attachment mirror and `/update` fetches have no timeout: one stalled download hangs the worker. | Medium | Low | `AbortSignal.timeout`. |
| PERF-1 | Two queries divide by a bound JS number, which SQLite treats as REAL, so the day bucket is fractional. Weekly active users and the Pulse daily chart are wrong, and the queries return 30x to 3,600x more rows than needed. | High (wrong numbers) | Low | `CAST(... AS INTEGER)` |
| DEP-5 | CI runs on Node 20 (end of life). | Medium | Low | CI on Node 24, actions v5 to v7. |

### Tier 2: medium impact or medium fix risk (v26)

| ID | Finding | Plan |
|---|---|---|
| DEP-3 | `@anthropic-ai/sdk` 0.91.1 is a devDependency; production installs with `--omit=dev`. | Move to dependencies at `^1.8.0`. |
| REL-3, REL-12 | Ticket open has a 5 second in-memory cooldown and no check for an existing open ticket; a failed greeting reports failure although the channel exists. | One open ticket per user per type; report partial success. Behavior change. |
| REL-4 | `guildMemberRemove` returns early for leavers without an application and skips verify-thread cleanup. | Reorder. |
| REL-7 | One throw in `stopSchedulers()` skips the remaining flushes and `db.close()`. | Isolate each step. |
| REL-9 | Buffered welcome line is lost on restart. | Flush on shutdown. |
| REL-10 | `/redeemreward` removes the ticket role before checking the artist queue. | Check first. |
| REL-13 | Unguarded log awaits in `guildEvents.ts` abort the rest of the member handlers. | Guard. |
| REL-15 | The 10 second event timeout fires for slow slash commands that already deferred. | Exempt interaction events. |
| REL-17 | No `client.on("error")` listener. | Add. |
| SEC-8 | Workflows have no `permissions:` block; one third-party action is pinned by tag. | Least privilege, pin by SHA. |
| TCD-1, TCD-2 | Coverage ignores files that are never imported. | `coverage.include`, then re-baseline thresholds to the real numbers. |
| TCD-13, TCD-15 | No dashboard checks in CI; no concurrency, timeouts or branch triggers. | Add a `web` job (svelte-check, build), concurrency and timeouts. |
| TCD-22 | Nothing checks that the help registry lists every command. | Parity test. |
| HEALTH-1, HEALTH-2 | Lint cannot pass: test files use `any` freely, about 85 real errors in `src`. | Relax `no-explicit-any` for tests, fix the `src` errors, make lint a hard gate. |
| HEALTH-3 | 839 files fail the format check. | One mechanical `prettier --write` commit, listed in `.git-blame-ignore-revs`, then make format a hard gate. |
| HEALTH-4, HEALTH-5, HEALTH-20, HEALTH-21 | 60 tracked `.playwright-mcp/` files, stale root docs, knip leftovers. | Clean up, make knip a hard gate. |
| DEP-8, DEP-9, DEP-10, DEP-13 | Dead overrides, in-range tooling updates, engines field disagrees with CI and the build target, stray `@types/sharp`. | Align. |
| PERF-3 | `/audit members` runs a 115 ms table scan per absent member (no index on `message_activity(guild_id, user_id)`). | Additive index migration. Measured. |
| PERF-4 | `/activity` heatmap reads 222,882 raw rows where a grouped query returns 1,344. | Group in SQL. Measured. |
| PERF-5 | Member join and leave handlers wait on a Discord log send before doing their real work. | Do the work first. Measured. |
| PERF-9 | Synchronous PNG encode on the event loop (27 ms per image). | Async encode. Measured. |

### Tier 3: deferred to the next release

Reasons are given per group. Tracked in #00286.

| ID | Finding | Why not today |
|---|---|---|
| Sentry 11, zod 4, vitest 5, eslint 10, TypeScript 7 | Major upgrades | Each needs a migration pass of its own. TypeScript 7 is blocked by the typescript-eslint peer range. The zod advisory is in the v4 code path, which this repo does not use. |
| better-sqlite3 12.11 and 13 | Newer builds drop the Node 20 prebuild; 13 needs Node 22+ | Production Node version is unknown. Held at the locked version until `node -v` on the host is confirmed. |
| SvelteKit 3, Vite 8, vite-plugin-svelte 7, adapter-node 6, `@lucide/svelte`, mermaid 12 | Coordinated dashboard major upgrade | Cannot be verified against the live dashboard today. |
| dotenv 18, dotenvx 2, ioredis 6, web-push 4 | Majors with config or API changes | Low value today, each touches startup. |
| SEC-3b | Dashboard API trusts `tier` and `userId` from the request body | Needs a design change (derive tier in the bot). The loopback bind in v26 removes the remote path. |
| SEC-4 | Session freezes roles for 7 days and stores OAuth tokens in the cookie | Needs server-side sessions. |
| SEC-6 | Several commands have no in-handler permission check | Needs a per-command decision and a table-driven test. |
| SEC-9, SEC-10, SEC-11, SEC-12, SEC-14 to SEC-18 | ssh-keyscan trust on deploy, ports 3002 and 3004 on all interfaces, shell strings in `/database`, OAuth state not bound to the browser, nginx headers, cookie size, role logging, public internal docs, Sentry scrubbing | Touch deploy scripts, hosting or auth flows that cannot be exercised today. |
| REL-5 | Database restore copies a live WAL database with `fs.copyFile` | Medium risk, needs a restore drill on a copy. |
| REL-8, REL-11, REL-14, REL-16, REL-18 | Late signal handlers, level reward retry can double-credit, `/redeem` never defers, schedulers without reentrancy guards, SQLite datetimes parsed as local time | Each needs characterization tests first. |
| PERF-2 | Stats refresh does all its reads inside one write transaction | Needs production timing to prove and a careful rewrite. |
| PERF-7, PERF-8 | Unused and redundant indexes | Dropping an index is destructive: owner decision, measure on the host first. |
| PERF-6, PERF-10 to PERF-15 | `execSync` git calls, smaller items | Low value. |
| HEALTH-6 | `setDMPermission(false)` is deprecated (52 uses) | Changes every command payload; do it with a command re-registration. |
| HEALTH-7, HEALTH-9, HEALTH-10, HEALTH-11 | 115 direct `process.env` reads, 1069-line interaction router, 1267-line config module, two error-card implementations | Refactors with no user-visible gain today. |
| TCD-3 to TCD-8, TCD-10, TCD-11 | Thin coverage in gate flow, review actions and tickets; no migration-versus-fixture drift test; tests not typechecked | Characterization tests are added only where v26 changes code. |
| TCD-14, TCD-20 | `deploy-handbook.yml` deploys without waiting for CI; `deploy.sh` lacks typecheck and branch checks | Deploy path: owner decision, see section 7. |

## 4. Ordered work list

1. Baseline (done, section 2).
2. This plan.
3. `/investigate-artist` (#00279): SDK dependency, migration, feature modules, command, tests, docs, dry run against a real ticket.
4. Safe upgrades and fixes: security (#00280), reliability (#00281), dependencies and runtime (#00282), CI and tooling (#00283). Characterization tests come first where the touched code has thin coverage.
5. Optimizations (#00284), each with a before and after number.
6. Mechanical format commit, then lint, format and knip become hard gates.
7. Release prep (#00285): version 26.0.0, changelog, README, CLAUDE.md, clean-clone verification.

Anything that breaks and cannot be fixed cleanly is reverted and moved to Tier 3 with the reason.

## 5. `/investigate-artist` design

### Workflow sources

| Source | Where | What it defines |
|---|---|---|
| Applicant requirements | Embed in the verify-artist channel, the ticket panel, and the Ticket Tool greeting (identical text, read 2026-11-14) | What an applicant must submit |
| Staff handbook | `docs/MOD-HANDBOOK.md`, "Commissions Verification" | How staff verify authorship, red and green flags, AI policy |
| Art rules | art-rules channel, "Last Revision - 4/8/26"; handbook "Art Bases" | Base credit rule, no tracing, AI or theft |
| Verify Blacklist | Staff forum thread, 2026-05-13 | Users previously refused for verification |

Criteria the command scores, each cited to its source in the output:

1. **Process evidence**: "3 different WIP/Layers to previous work" (requirements); handbook minimum evidence, at least two of: recorded timelapse of 30 seconds or more, layered source file with dated layers, WIP photo with handwritten date and client identifier.
2. **Finished client work**: "Previous finished work with a client" (requirements).
3. **Terms of service**: "Need a form of ToS" (requirements).
4. **Active commissions**: active commission artist, a commission in the last 6 months (requirements).
5. **Foundational skill**: understands shading; rendering skill is not required (requirements).
6. **Style and skill consistency**: sudden jumps and inconsistent portfolio are red flags (handbook).
7. **Provenance**: reverse image search results versus the handles the applicant claimed (handbook supporting methods; art rules on theft).
8. **AI indicators**: handbook AI policy and "Spotting AI Art" table.
9. **Base use**: bases are allowed with credit (art rules). The workflow does not say whether base-made work counts as verification evidence, and the command says so plainly.
10. **Account and history**: account age under 6 months with no traceable history is a red flag (handbook); Verify Blacklist entry; earlier verification tickets.

### Decisions

- **Owner only.** `isOwner(interaction.user.id)` (from `OWNER_IDS`) is checked in the handler before anything else. Everyone else gets a short ephemeral refusal.
- **Private.** Ephemeral defer first, every reply ephemeral, nothing posted to the ticket, no public log line. Private structured logs carry counts and cost only, no content.
- **Ticket check.** A channel qualifies if it has a first-party ticket row of type `2d-artist`, or it sits in the tickets category and its name starts with `2d-artist-` (Ticket Tool, open or closed). The applicant comes from the ticket row, then the greeting mention, then the member permission overwrite. An optional `applicant` option overrides.
- **Collection.** Full history with pagination. Images from attachments and embeds, fetched as bytes at run time. Videos and source files are listed but cannot be inspected, and the output says so. Links and gallery handles are parsed from message text.
- **Provenance services.**

  | Service | Use | Auth | Limits honored |
  |---|---|---|---|
  | Fluffle (fluffle.xyz) | Yes, always on | None; descriptive User-Agent required | One request at a time |
  | e621 | Yes, when `E621_LOGIN` and `E621_API_KEY` are set | HTTP Basic | 1 request per second |
  | SauceNAO | Yes, when `SAUCENAO_API_KEY` is set | API key | 4 per 30 seconds, daily quota from response headers |
  | Google Vision Web Detection | Not built | | Billing is off in production; owner decision |
  | TinEye | Not built | | Paid, about 200 USD minimum: owner decision |
  | FuzzySearch | Not built | | No public way to get a key |
  | IQDB.org, Kheina, Bing Visual Search | Not used | | Anime boorus only; site down; API retired |
  | FurAffinity, Pixiv, Inkbunny pages, ArtStation, Toyhou.se | Never scraped | | Terms forbid it or no official API |

  A service without a key is skipped and named as skipped. One failing service does not stop the run. Results are cached by image hash.
- **Model.** `claude-opus-5-5` by default (`INVESTIGATE_MODEL` overrides), chosen from the live model and pricing pages on 2026-11-14: 4 USD per million input tokens, 20 USD per million output tokens, vision, structured output. Images are downscaled to about 1568 px on the long edge before upload. Expected cost is about 0.25 to 0.40 USD per run.
- **Budget.** Every run records tokens and estimated cost. The footer shows the run cost and the month total. A run is refused when the month total plus the estimate would pass `INVESTIGATE_MONTHLY_CAP_USD` (default 200).
- **Advisory only.** The command never approves, denies, assigns roles or messages the applicant. Indicators come with reasoning and a confidence statement, never a verdict.

### What cannot be verified before release

- The command cannot be registered or run as a real interaction without a test guild. It is verified by unit tests with all external APIs mocked and by a local dry run that reads a real ticket over REST (no gateway login, nothing sent to Discord).
- SauceNAO and e621 adapters are verified against live response shapes only as far as anonymous access allows. No keys exist yet.

## 6. Verification approach

- Build and tests run after every commit.
- Characterization tests are written before a fix where the touched code has no coverage.
- Every optimization has a measured before and after number or it is not called an optimization.
- Final check from a clean clone: install, build, lint, typecheck, format check, knip, full tests, dashboard check and build.

## 7. Decisions waiting on the owner

These do not block the release. Each has the prep done and a recommendation.

1. **Reverse image search accounts.** SauceNAO (free account, API key) and e621 (free account, API key) each need a sign-up. Recommendation: create both; without them only Fluffle runs. TinEye is paid and Google Vision needs billing turned on: recommendation is to skip both for now.
2. **Workflow differences.** The handbook says "at least two of timelapse, layered file, dated WIP photo"; the public requirements say "3 different WIP/Layers" and list speedpaints as helpful. Three different "6 months" rules exist (account age, last commission, and an older greeting that asks for 6 months of experience). Base-made work as verification evidence is not covered. The command reports against both sources and flags the gap. Recommendation: pick one wording and update the handbook and the embed together.
3. **Private staff thread.** Each Ticket Tool ticket has a private staff thread. The command does not read it. Say if it should.
4. **Dashboard API bind (SEC-3).** v26 binds the internal API to `127.0.0.1`. Both PM2 apps run on one host, so this should be invisible. If the dashboard ever runs elsewhere, set `DASHBOARD_API_HOST=0.0.0.0`.
5. **Production Node version.** Run `node -v` on the host. If it is Node 20, upgrade to Node 24 LTS (supported to 2028-04) before or soon after this release; nothing in v26 requires it. After that, better-sqlite3 can move forward.
6. **Merging to main deploys the dashboard.** `.github/workflows/deploy-handbook.yml` runs on every push to `main` that touches `docs/**` or `web/**` and does not wait for CI. Merging this branch will trigger it. Recommendation: merge when you are ready to watch it, and consider gating that workflow on CI.
7. **GitHub bot token.** If `/update banner` or `/update avatar` ever failed in a public channel, the token was shown. Recommendation: rotate `GITHUB_BOT_TOKEN`.
8. **`/purge` policy.** The handler checks the password and Discord's ManageMessages default permission, with no role check in code. The permission matrix documents exactly that, so it was left alone. Say if it should require a staff role.
9. **Ticket system cutover.** `docs/TICKET-SYSTEM-CUTOVER.md` is stale (the first-party counter seed is 144, live numbering is past 0309). Not part of v26.
10. **Features that look dead.** `/movie` (superseded by game night code paths), `/admin-migrate-unverified`, `/test`, `/sample`, `/testidea`, `/skullmode`, `/developer`, the research pipeline scripts, `scripts/deploy-commands.ts`, `deploy-no-tests.sh`. Nothing was removed. Say which can go.
11. **Unused and redundant indexes** (PERF-7, PERF-8). Dropping them is destructive. Recommendation: measure on the host first; the SQL is prepared in #00286.
