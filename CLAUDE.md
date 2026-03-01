# Pawtropolis Tech - CLAUDE.md

## Project Overview
Discord gatekeeping bot (v5.1.1) for the Pawtropolis server. Built by watchthelight (Bash).
TypeScript, Discord.js 14, better-sqlite3, Node 20+, ESM modules.

## Quick Reference
- **Repo**: https://github.com/watchthelight/pawtropolis-tech
- **Server**: `ubuntu@3.209.223.216` (SSH alias: `pawtropolis`)
- **Remote path**: `/home/ubuntu/pawtropolis-tech`
- **PM2 process**: `pawtropolis`
- **Database**: SQLite at `./data/data.db`
- **Entry point**: `src/index.ts` -> `dist/index.js`

## Build & Run

```bash
npm run build        # tsup build (src/index.ts + scripts/commands.ts)
npm run dev          # dotenvx + tsx watch (hot reload)
npm start            # dotenvx + node dist/index.js
npm test             # vitest run
npm run check        # typecheck + lint + format:check + test
```

## Deployment

### Full Deploy (recommended)
```bash
./deploy.sh              # test + build + inject metadata + tarball + upload + migrate + register cmds + restart PM2
./deploy.sh --fast       # same but skip tests
./deploy.sh --restart    # just restart PM2 on remote
./deploy.sh --status     # check remote PM2 status
./deploy.sh --logs       # show logs after deploy
```

#### What deploy.sh does (9 steps):
1. Run tests (`npm test`) - skipped with `--fast`
2. Build (`npm run build` -> tsup)
3. Inject build metadata (`npx tsx scripts/inject-build-info.ts` -> `.env.build`)
4. Create tarball (`dist/ migrations/ scripts/ package.json package-lock.json .env.build`)
5. Upload tarball via SCP to `pawtropolis:/home/ubuntu/pawtropolis-tech/`
6. Extract + `npm ci --omit=dev` on remote
6.5. Run migrations (`node scripts/migrate-remote.js`)
6.6. Register slash commands with Discord (`npx dotenvx run -- tsx scripts/commands.ts --all`)
7. Restart PM2 (`pm2 restart pawtropolis`)
8. Health check (wait 3s, verify PM2 status)
9. Cleanup tarballs (remote + local)

### Quick Deploy (no tests)
```bash
./deploy-no-tests.sh     # skip tests, otherwise same flow
```

### Unified Start/Stop Script (Windows + Unix)
```bash
# Unix
./scripts/start.sh --local              # dev mode (pulls remote DB first)
./scripts/start.sh --local --fresh      # clean install + rebuild + start
./scripts/start.sh --remote             # restart PM2 on server
./scripts/start.sh --remote --fresh     # full deploy to server
./scripts/start.sh --switch             # intelligent local<->remote switch with DB sync
./scripts/start.sh --stop               # stop all processes (local + remote)
./scripts/start.sh --push-remote        # push local DB to remote (explicit only)
./scripts/start.sh --recover            # interactive DB recovery
./scripts/start.sh --skip-sync          # skip DB sync

# Windows
scripts\start.cmd [same flags]
```

### Command Registration
Slash commands must be registered separately with Discord's API:
```bash
npm run deploy:cmds      # register all slash commands
npm run sync:cmds        # sync all commands
```

## Database Sync
- Default: always pulls remote DB -> local (never pushes unless `--push-remote`)
- Creates timestamped backups before any sync
- Integrity checks via `scripts/verify-db-integrity.js`
- Manifest written to `data/.db-manifest.json`
- WAL checkpoint before sync to ensure consistency

## Key Directories
```
src/              # TypeScript source
  commands/       # slash command handlers
  events/         # Discord event listeners
  listeners/      # additional listeners
  features/       # feature modules
  lib/            # shared utilities
  db/             # database layer
  config/         # configuration
  web/            # web dashboard
  ui/             # UI builders
  ops/            # operational tools
  store/          # state management
  scheduler/      # scheduled tasks
  logging/        # logging system
  constants/      # constants
scripts/          # build, deploy, migration, utility scripts
migrations/       # database migrations
tests/            # vitest tests (mirrors src/ structure)
data/             # SQLite databases (gitignored)
authentication/   # PEM keys (gitignored)
assets/           # images, banners
docs/             # documentation
audit/            # command audit reports
context/          # context documents
```

## Environment
- `.env` - main config (DISCORD_TOKEN, CLIENT_ID, GUILD_ID, DB_PATH, etc.)
- `.env.build` - auto-generated build metadata (BUILD_GIT_SHA, BUILD_TIMESTAMP, BUILD_DEPLOY_ID)
- `.env.example` - template with all variables documented
- Loaded via `@dotenvx/dotenvx` in dev, `dotenv` on remote

## SSH Config
```
Host pawtropolis
    HostName 3.209.223.216
    User ubuntu
    IdentityFile ~/.ssh/id_ed25519
```
All deploy scripts use `pawtropolis` as the SSH alias, matching the SSH config.

## Important Notes
- Node >= 20.0.0 required
- ESM modules (`"type": "module"`)
- tsup bundles to `dist/` (index.js + scripts/commands.js)
- PM2 manages the process on the server
- Sentry integration for error tracking
- Google Cloud Vision for avatar scanning
