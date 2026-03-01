# Architecture - Pawtropolis Tech

> Auto-generated project documentation | 2026-03-01 | Exhaustive Scan

## Executive Summary

Pawtropolis Tech is a production-grade Discord bot backend built as a monolithic TypeScript application. It uses an event-driven architecture centered on Discord.js v14, with SQLite for persistence, modular feature organization, and comprehensive observability via Sentry and Pino.

## Technology Stack

| Category | Technology | Version | Rationale |
|----------|-----------|---------|-----------|
| Language | TypeScript | 5.5 | Type safety, modern async, strict mode |
| Runtime | Node.js | 20+ | ESM modules, stable LTS |
| Framework | Discord.js | 14.16.3 | Official Discord API wrapper, slash commands, interactions |
| Database | better-sqlite3 | 12.4.1 | Synchronous, deterministic, embedded (no external DB server) |
| Web Server | Fastify | - | Lightweight HTTP for dashboard/OAuth2 endpoints |
| Image Processing | canvas, sharp | 3.2.0, 0.34.4 | Embed rendering, image optimization |
| Error Tracking | @sentry/node | 10.20.0 | Production error monitoring + performance profiling |
| Logging | pino | 10.0.0 | Structured JSON logging with pretty dev output |
| External APIs | @google-cloud/vision | 5.3.4 | Avatar NSFW content detection |
| Validation | zod | 3.23.8 | Runtime schema validation for env vars and inputs |
| Bundler | tsup | 8.1.0 | Fast ESM bundling for Node.js |
| Testing | vitest | 3.x | Vite-native test runner with v8 coverage |

## Architecture Pattern

### Event-Driven Modular Monolith

```
                    ┌─────────────────────────────────────┐
                    │          Discord Gateway            │
                    │   (WebSocket Events + Interactions)  │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │         src/index.ts                 │
                    │     Central Event Router             │
                    │  (interactionCreate, messageCreate,  │
                    │   guildMemberAdd, voiceStateUpdate)  │
                    └──┬───────┬──────────┬───────┬───────┘
                       │       │          │       │
              ┌────────▼┐ ┌───▼────┐ ┌───▼───┐ ┌─▼──────┐
              │Commands │ │Features│ │Events │ │Listeners│
              │37 slash │ │20+ mod │ │Forum  │ │DadMode  │
              │commands │ │ules    │ │Notify │ │SkullMode│
              └────┬────┘ └───┬────┘ └───────┘ └─────────┘
                   │          │
              ┌────▼──────────▼──────────────────────────┐
              │              src/lib/                      │
              │    Shared Utilities (40+ modules)          │
              │  (logger, sentry, config, cmdWrap, etc.)  │
              └────────────────┬──────────────────────────┘
                               │
              ┌────────────────▼──────────────────────────┐
              │              src/db/                       │
              │     SQLite (better-sqlite3, WAL mode)     │
              │     Prepared statements, 30+ tables       │
              └───────────────────────────────────────────┘
```

### Command Routing

The main entry point (`src/index.ts`, ~2143 lines) acts as a central router:

1. **Slash Commands**: Routed by command name to handlers in `src/commands/`
2. **Button Interactions**: Routed by custom ID regex patterns (e.g., `v1:decide:approve:code[HEX6]`)
3. **Modal Submissions**: Routed by modal custom ID patterns
4. **Select Menus**: Routed by select menu custom ID
5. **Context Menus**: Not currently implemented

All handlers are wrapped with `wrapEvent()` for consistent error handling, Sentry breadcrumbs, and error card generation.

### Feature Module Architecture

Each feature is self-contained in `src/features/`:

```
src/features/review/
├── index.ts              # Barrel export
├── types.ts              # TypeScript type definitions
├── queries.ts            # Database queries (prepared statements)
├── claims.ts             # Claim management logic
├── card.ts               # Discord embed builder
├── welcome.ts            # Welcome message flow
├── handlers.ts           # Event handlers
├── flows/                # Decision transaction flows
│   ├── approve.ts        # Approval flow
│   ├── reject.ts         # Rejection flow
│   └── kick.ts           # Kick flow
└── handlers/             # Interaction handlers
    ├── buttons.ts        # Button click handlers
    ├── modals.ts         # Modal submission handlers
    ├── claimHandlers.ts  # Claim-specific handlers
    └── actionRunners.ts  # Action execution
```

**Design Principles:**
- Features import `db` and `lib` modules but never import other features directly
- Each feature owns its queries (no shared query layer)
- Barrel files re-export submodules for clean imports

### Database Architecture

**Pattern**: Direct SQL with prepared statements (no ORM)

```
src/db/db.ts              # Connection management, PRAGMA setup
src/db/ensure.ts          # Schema creation/validation at startup

migrations/               # 45 versioned migration files
├── 001_*.ts             # Each migration runs in a transaction
├── ...                  # Idempotent (IF NOT EXISTS checks)
└── 045_*.ts             # Tracked in schema_migrations table
```

**Key Design Decisions:**
- **Synchronous SQLite**: better-sqlite3 chosen for simplicity and determinism (no async race conditions)
- **WAL Mode**: Enables concurrent readers during writes
- **Prepared Statements**: All queries parameterized via `db.prepare()` (SQL injection protected)
- **No ORM**: Fine-grained control over queries, explicit over implicit
- **Foreign Keys Enforced**: `PRAGMA foreign_keys = ON`
- **Legacy SQL Detection**: Blocks deprecated table/column usage via regex patterns

### Configuration Architecture

```
.env                      # Secrets (gitignored)
.env.example              # Template with all variables documented
.env.build                # Auto-generated build metadata

src/lib/env.ts            # Zod schema validation (fail-fast at startup)
src/config.ts             # Global config (OWNER_IDS, etc.)
guild_config table        # Per-guild settings (30+ columns)
```

**Layers:**
1. **Environment Variables**: Zod-validated at startup, fail-fast on missing required vars
2. **Global Config**: Bot-wide settings in `src/config.ts`
3. **Per-Guild Config**: Database-driven, queryable per guild (channels, roles, flags, thresholds)
4. **Build Metadata**: Git SHA, timestamps, deploy ID injected at build time
5. **Feature Flags**: Database-driven toggles for per-guild feature control

### State Management

9 state stores in `src/store/`:

| Store | Purpose |
|-------|---------|
| `flagsStore` | Feature flag toggles |
| `byteMultiplierStore` | XP multiplier tracking |
| `auditFindingsStore` | Audit results |
| `auditSessionStore` | Audit session state |
| `securitySnapshotStore` | Security audit snapshots |
| `acknowledgedSecurityStore` | Acknowledged security issues |
| `nsfwFlagsStore` | NSFW detection flags |
| `gameConfigStore` | Game event configuration |
| `aiDetectionToggles` | AI detection service toggles |

### Scheduled Tasks

7 background schedulers in `src/scheduler/`:

| Scheduler | Purpose | Pattern |
|-----------|---------|---------|
| `eventTimeoutScheduler` | Auto-end events after 12 hours | Polling (5 min) |
| `securityAuditScheduler` | Periodic security snapshots | Configurable interval |
| `byteMultiplierScheduler` | Expire XP multiplier tokens | Periodic |
| `modMetricsScheduler` | Aggregate moderator statistics | Periodic |
| `opsHealthScheduler` | Health monitoring checks | Configurable |
| `diskSpaceScheduler` | Monitor disk usage | Periodic |
| `staleApplicationCheck` | Clean up stale applications | Periodic |

### Web Endpoints

Two lightweight HTTP servers via Fastify:

**Status API** (Port 3002):
- `/api/status` - Shields.io badge JSON (uptime, ping)
- `/api/health` - Detailed health check JSON

**Linked Roles OAuth2** (Port 3001):
- `/linked-roles` - Discord OAuth2 initiation
- `/linked-roles/callback` - OAuth2 callback + metadata push

### Logging & Observability

```
src/lib/logger.ts         # Pino structured logging
src/lib/sentry.ts         # Sentry error tracking + profiling
src/features/opsHealth.ts # Health monitoring (queue backlog, p95, ws ping)
```

**Pino Logger**:
- JSON output in production, pretty-printed in dev
- Automatic redaction of tokens, DSN secrets, @mentions
- Max 300 chars per value to prevent log flooding

**Sentry Integration**:
- Automatic on unhandled rejections/exceptions + manual in error handlers
- Custom breadcrumbs for interactions and events
- Performance profiling with configurable sample rate (default 10%)

### Error Handling Strategy

```
Global Exception Handlers (uncaughtException, unhandledRejection)
    └── wrapEvent() decorator on all event handlers
        └── Error cards displayed to users
            └── Sentry capture with breadcrumbs
                └── Structured logging via Pino
```

### Security Architecture

- **Input Validation**: Zod schemas, regex validation on custom IDs
- **SQL Injection Prevention**: All queries use prepared statements
- **Command Injection Prevention**: Regex validation on shell parameters
- **CSRF Protection**: State tokens in OAuth2 flow
- **Timing Attack Protection**: Constant-time password comparison
- **Mention Safety**: `allowedMentions` whitelist on all messages
- **Rate Limiting**: Per-user, per-guild cooldowns on sensitive commands
- **Permission Hierarchy**: Role-based access with owner-only gates
- **Secret Redaction**: Tokens and DSN URLs redacted from logs

### Deployment Architecture

```
┌──────────────┐    tarball/SCP    ┌──────────────────────┐
│  Local Dev   │ ───────────────→  │  Ubuntu EC2 Server   │
│  (Windows)   │                   │  3.209.223.216       │
│              │    SSH/PM2        │                      │
│  npm run dev │ ←───────────────  │  PM2: pawtropolis    │
│  tsx watch   │    logs/status    │  node dist/index.js  │
└──────┬───────┘                   └──────────┬───────────┘
       │                                      │
       │  DB Sync (SCP)                       │
       │  remote → local (default)            │
       ▼                                      ▼
  data/data.db                          data/data.db
  (local copy)                          (production)
```

**Deploy Pipeline** (`deploy.sh`):
1. Test → 2. Build → 3. Inject metadata → 4. Tarball → 5. Upload SCP → 6. Extract + npm ci → 7. Migrate DB → 8. Register commands → 9. Restart PM2 + health check

### Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| **Monolith over microservices** | Single bot process; no need for service mesh complexity |
| **SQLite over PostgreSQL/MySQL** | Embedded, zero-config, deterministic; sufficient for single-server bot |
| **Synchronous DB (better-sqlite3)** | No async race conditions; simpler error handling |
| **Direct SQL over ORM** | Full control over queries; avoid ORM abstraction leaks |
| **Modular features** | Self-contained modules prevent tangled dependencies |
| **Event wrapping** | Consistent error handling across all interaction types |
| **Fail-fast config** | Zod validation catches missing secrets at startup, not first use |
| **Build-time metadata** | Git SHA and timestamps enable reproducible deployments |
| **Per-guild configuration** | Database-driven config allows customization without code changes |
| **Tarball deployment** | Simple, reliable; no container orchestration needed |

## Cross-References

- Detailed system overview: [docs/architecture/system-overview.md](./architecture/system-overview.md)
- API contracts: [docs/api-contracts.md](./api-contracts.md)
- Database schema: [docs/data-models.md](./data-models.md)
- Source tree: [docs/source-tree-analysis.md](./source-tree-analysis.md)
- Development guide: [docs/development-guide.md](./development-guide.md)
