# Pawtropolis Tech Gatekeeper

Source-available Discord bot for Pawtropolis that runs a gated application flow with staff tools.

[![Node.js 20](https://img.shields.io/badge/Node.js-20.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![discord.js v14](https://img.shields.io/badge/discord.js-v14-5865F2?logo=discord&logoColor=white)](https://discord.js.org/#/)
[![License ANW-1.0](https://img.shields.io/badge/license-ANW--1.0-0a2f5a)](LICENSE)

## Table of Contents

- [Pawtropolis Tech Gatekeeper](#pawtropolis-tech-gatekeeper)
  - [Table of Contents](#table-of-contents)
  - [Quick Start](#quick-start)
    - [Prereqs](#prereqs)
    - [Install](#install)
    - [Setup `.env`](#setup-env)
    - [Database](#database)
    - [Deploy Guild Commands](#deploy-guild-commands)
    - [Run](#run)
  - [Configuration (ENV)](#configuration-env)
  - [Slash Commands](#slash-commands)
  - [How It Works](#how-it-works)
  - [Database](#database-1)
  - [Operations](#operations)
  - [Roadmap / Status](#roadmap--status)
  - [Troubleshooting](#troubleshooting)
  - [License](#license)

## Quick Start

### Prereqs

- Node.js 20 or newer
- Discord bot application with a token and client ID
- Guild where you can invite the bot with `bot` and `applications.commands` scopes

> Tip: Invite the bot to your staging guild before deploying to production.

### Install

```powershell
npm ci
```

```bash
npm ci
```

### Setup `.env`

```powershell
Copy-Item .env.example .env
notepad .env  # set DISCORD_TOKEN and CLIENT_ID
```

```bash
cp .env.example .env
${EDITOR:-nano} .env  # set DISCORD_TOKEN and CLIENT_ID
```

```env
# Required keys
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_application_id
```

> Note: Leave `GUILD_ID` empty for global command deployment, or set it to a single guild ID for faster updates.

### Database

```powershell
npm run db:migrate
npm run db:seed
```

```bash
npm run db:migrate
npm run db:seed
```

### Deploy Guild Commands

Set `GUILD_ID` in `.env` (temporary) for targeted deploys, then run:

```powershell
npm run deploy:cmds
```

```bash
npm run deploy:cmds
```

### Run

```powershell
# Development
npm run dev

# Production
npm run build
npm start
```

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

## Configuration (ENV)

| Key                         | Required | Default        | Notes                                                       |
| --------------------------- | -------- | -------------- | ----------------------------------------------------------- |
| `DISCORD_TOKEN`             | Yes      | -              | Bot token from the Discord developer portal.                |
| `CLIENT_ID`                 | Yes      | -              | Application client ID used for command registration.        |
| `GUILD_ID`                  | No       | -              | Limit command deploys to one guild; leave blank for global. |
| `NODE_ENV`                  | No       | `development`  | Accepts `development`, `production`, or `test`.             |
| `DB_PATH`                   | No       | `data/data.db` | SQLite database file path; created if missing.              |
| `SENTRY_DSN`                | No       | -              | Enable Sentry error tracking when set.                      |
| `SENTRY_ENVIRONMENT`        | No       | -              | Overrides environment name reported to Sentry.              |
| `SENTRY_TRACES_SAMPLE_RATE` | No       | `0.1`          | Sampling rate (0-1) for Sentry performance data.            |
| `LOG_LEVEL`                 | No       | -              | Sets Pino logger level (e.g., `info`, `debug`).             |
| `TEST_GUILD_ID`             | No       | -              | Used by seeds and tests for fixture data.                   |
| `TEST_REVIEWER_ROLE_ID`     | No       | -              | Used by seeds/tests; reviewer role granted draft access.    |

## Slash Commands

- `/health` - Anyone can run it; returns uptime and current WebSocket ping.
- `/gate` - Staff-only (Manage Guild or reviewer role). Includes `setup`, `config`, `status`, `reset`, `ensure-entry`, and `factory-reset` utilities for managing the gate flow.
- `/statusupdate` - Staff-only; updates the bot's presence text.

## How It Works

- `src/index.ts` boots the Discord client, loads command modules, and wires gateway handlers.
- Command modules in `src/commands/` encapsulate Slash command data and execution logic.
- Gate entry UX lives in `src/features/gate/`; it builds paginated modals, stores answers, and keeps the entry message pinned.
- SQLite (via `better-sqlite3`) stores guild configuration, applications, responses, moderator actions, and snapshots.
- Pino logging feeds structured logs; Sentry hooks capture exceptions and async errors when enabled.

## Database

- Default database path is `data/data.db` (configurable via `DB_PATH`).
- `src/db/connection.ts` enables WAL mode, foreign keys, busy timeouts, and graceful shutdown.
- Migrations in `migrations/` define schema for guild config, applications, responses, review actions, modmail bridge, and user snapshots.
- `npm run db:seed` populates test guild configuration, reviewer role, and sample questions.

## Operations

- Deploy commands with `npm run deploy:cmds` whenever Slash command definitions change.
- Check live health quickly with `/health`.
- Review [docs/SENTRY_SETUP.md](docs/SENTRY_SETUP.md) for full Sentry onboarding and tuning guidance.
- Back up the bot by copying `data/data.db` plus WAL files (`data.db-wal`, `data.db-shm`) while the process is stopped.

## Roadmap / Status

- [done] M1: Node 20 foundation, TypeScript build tooling, logging, env validation.
- [done] M2: SQLite schema, migrations, seed routines, connection tuning.
- [done] M3: `/gate` admin suite for setup, config management, status, and resets.
- [in-progress] M4: Gate entry UX polish (paged modals, draft persistence, pin management).
- [next] M5: Submission review cards and staff action flows.
- [next] M6: Acceptance/rejection/kick automation with role management.
- [next] M7: Modmail bridge enhancements, admin UX cleanup, observability extras.

## Troubleshooting

- **Slash commands not showing** - Ensure you invited the bot with `applications.commands`, set `GUILD_ID` if you want guild-only deploys, and rerun `npm run deploy:cmds`. Global commands can take up to an hour to propagate.
- **Missing Permissions (50013) when pinning** - Grant the bot `Manage Messages` in the gate channel so `/gate ensure-entry` can pin the entry embed.
- **Disable Sentry quickly** - Remove `SENTRY_DSN` from `.env`; the bot will start without Sentry and log that error tracking is disabled.

## License

This project is licensed under the Attribution-No Wholesale Copying License, Version 1.0 (ANW-1.0). See [LICENSE](LICENSE) for the legal text. When you reuse excerpts, include a NOTICE naming Pawtropolis Tech Gatekeeper, watchthelight (Bash), the repository URL, and this license.
