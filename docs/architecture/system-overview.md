# System Architecture Overview

## High-Level Component Map

```
┌─────────────────────────────────────────────────────────────┐
│                       Discord Gateway                        │
│  (Events: interactionCreate, messageCreate, guildMember...)  │
└───────────────────────┬─────────────────────────────────────┘
                        │
        ┌───────────────▼──────────────────┐
        │   Bot Client (discord.js v14)    │
        │  - Event handlers                │
        │  - Command router                │
        └───────┬──────────────────────────┘
                │
    ┌───────────┼───────────────────┐
    │           │                   │
┌───▼───┐  ┌───▼────┐       ┌──────▼──────┐
│ Gate  │  │Modmail │       │   Logger    │
│ (gate.│  │(modmail│       │  (logger.ts)│
│  ts)  │  │  .ts)  │       │             │
└───┬───┘  └───┬────┘       └──────┬──────┘
    │          │                   │
    │          │          ┌────────▼────────┐
    │          │          │  Pretty Cards   │
    │          │          │ (action embeds) │
    │          │          └────────┬────────┘
    │          │                   │
┌───▼──────────▼───────────────────▼─────────┐
│       Database (SQLite, better-sqlite3)    │
│  Tables: configs, review_action, action_   │
│          log, open_modmail                 │
└────────────────┬───────────────────────────┘
                 │
         ┌───────▼────────┐
         │  Telemetry     │
         │  (Sentry SDK)  │
         │  [optional]    │
         └────────────────┘
```

## Core Modules

### Commands Layer (`src/commands/*.ts`)

Parses slash commands, validates options, and dispatches to feature modules. Permission checks run before handler execution.

**Key Files**:

- `gate.ts`: `/gate`, `/accept`, `/reject`, `/unclaim`, `/kick`
- `modmail.ts`: `/modmail` (close/reopen)
- `config.ts`: `/config` (get/set guild settings)
- `modstats.ts`: `/modstats` (leaderboard, user drill-down)
- `send.ts`: `/send` (anonymous broadcasts)
- `analytics.ts`: `/analytics`, `/analytics-export`

### Gate and Review Module (`src/features/gate.ts`, `review.ts`)

Manages application submission, claim/unclaim, approve/reject workflows. Tracks review history in `review_action` table.

- Validates application fields (age, reason length)
- Prevents duplicate claims via atomic DB transactions
- Generates review cards with interactive buttons
- Sends DM notifications to applicants
- Persists review history with free-text reasons

**State Machine**:

```
[Pending] ──claim──> [Claimed] ──accept/reject──> [Decided]
    ▲                    │
    └─────unclaim────────┘
```

### Modmail Module (`src/features/modmail.ts`)

Routes DMs to staff threads and back; tracks conversations in `open_modmail` table. Creates persistent threads in the designated modmail channel.

- Creates a thread on first DM from a user
- Mirrors messages in both directions (user DM to staff thread and back)
- Closes/reopens threads via command or auto-archive
- Links modmail threads to applications (`related_app_id`)

**Known Issue**: Permission 50013 errors when bot lacks `SendMessagesInThreads`.

### Logger Module (`src/features/logger.ts`)

Generates "pretty cards" (rich embeds) for all moderator actions and posts them to the guild-configured logging channel.

- Fetches logging channel from DB (`configs.logging_channel_id`) with env fallback
- Builds color-coded embeds (green/red/blue/yellow)
- Falls back to console logging when the channel is unreachable
- Action types: `claim`, `unclaim`, `accept`, `reject`, `kick`, `modmail_open`, `modmail_close`, `config_change`

Logging channel is configurable via `/config set logging` and stored in the database.

### Analytics Module (`src/commands/stats/`)

Queries `review_action` and `action_log` tables to generate performance metrics.

**Metrics Calculated**:

- Total claims, accepts, rejects per moderator
- Average response time (claim → decision)
- Acceptance ratio (accepts / total decisions)
- Leaderboard ranking by claim volume
- Per-moderator KPIs (median/P95 response time)

**Output Formats**: Markdown tables (in-Discord), CSV export (attachment)

## Event and Data Flow

### Application Lifecycle

```
1. User submits /gate form
   ├→ Insert into review_action table (status: pending)
   ├→ Post review card in staff channel (embed + [Claim] button)
   └→ [Known Issue] History not visible until claim action

2. Moderator clicks [Claim]
   ├→ Atomic update: SET claimed_by = moderator_id
   ├→ Insert action_log row (action: claim)
   ├→ [Known Issue] Logger may not post card if channel config broken
   └→ Update card embed (show "Claimed by @Moderator")

3. Moderator runs /accept <app_id> "reason"
   ├→ Validate claim ownership
   ├→ Insert action_log (action: accept, reason: free-text)
   ├→ Update status = accepted
   ├→ Send DM to applicant (approval template)
   ├→ [Known Issue] Pretty card sometimes not emitted
   └→ Grant member role (if configured)

4. (Alternative) /reject <app_id> "reason"
   ├→ Similar flow; status = rejected
   ├→ DM rejection template
   ├→ Optionally kick from guild
```

### Modmail Routing

```
1. User DMs bot
   ├→ Lookup open_modmail by user_id
   ├→ If none: CREATE THREAD → insert row
   ├→ Mirror DM → thread (embed with avatar/timestamp)

2. Staff replies in thread
   ├→ Validate thread exists in open_modmail
   ├→ Send reply to user DM
   ├→ React ✅ to confirm delivery
   ├→ [Known Issue] 50013 error if missing permissions

3. /modmail close
   ├→ SET status = closed
   ├→ Archive + lock thread
   ├→ [Known Issue] Thread sometimes not deleted/archived (permission issue)
   ├→ Send DM: "Conversation closed"
```

## Technology Stack

| Layer       | Technology                   | Notes                                          |
| ----------- | ---------------------------- | ---------------------------------------------- |
| Runtime     | Node.js 20 (LTS)             | ES modules, top-level await supported          |
| Language    | TypeScript 5.x               | Strict mode; built with tsup                   |
| Discord SDK | discord.js v14               | Intents: Guilds, GuildMessages, DirectMessages |
| Database    | better-sqlite3 (SQLite 3.x)  | Synchronous API; file at `./data/data.db`      |
| Build       | tsup (esbuild)               | Fast bundler; outputs ESM to `dist/`           |
| Config      | dotenvx                      | Environment variable loader                    |
| Telemetry   | @sentry/node + OpenTelemetry | Optional; requires valid SENTRY_DSN env var    |
| Deployment  | Systemd / PM2 (bare-metal)   | No containerization yet; local file DB         |

## Error Handling Strategy

### Database Errors

```typescript
try {
  db.prepare("INSERT INTO review_action ...").run(data);
} catch (error) {
  if (error.code === "SQLITE_CONSTRAINT") {
    // Handle duplicate application
    return interaction.reply({ content: "Already submitted.", ephemeral: true });
  }
  Sentry.captureException(error); // Requires valid SENTRY_DSN
  console.error("DB error:", error);
  return interaction.reply({ content: "Database error. Try again.", ephemeral: true });
}
```

### Discord API Errors

```typescript
try {
  await user.send(dmEmbed);
} catch (error) {
  if (error.code === 50007) {
    // Cannot send DM (user blocks bot)
    console.warn(`Cannot DM user ${user.id}: blocked`);
    return; // Continue flow; don't block accept/reject
  }
  throw error; // Re-throw unexpected errors
}
```

### Logging Fallback

```typescript
const loggingChannel = getLoggingChannel(guildId); // DB → env → null
if (!loggingChannel) {
  console.warn("No logging channel; skipping action card");
  return;
}

try {
  await loggingChannel.send({ embeds: [card] });
} catch (error) {
  console.error(`Failed to post to logging channel:`, error);
  // Fallback: structured console log
  console.log(JSON.stringify({ action, appId, timestamp }));
}
```

## Configuration System

### Guild-Specific Config (`configs` table)

```sql
CREATE TABLE configs (
  guild_id TEXT PRIMARY KEY,
  review_channel_id TEXT,
  modmail_channel_id TEXT,
  member_role_id TEXT,
  acceptance_message TEXT,
  rejection_message TEXT,
  auto_kick_rejected INTEGER DEFAULT 0,
  logging_channel_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**Access Pattern**:

```typescript
const config = db.prepare("SELECT * FROM configs WHERE guild_id = ?").get(guildId);
const reviewChannel = client.channels.cache.get(config.review_channel_id);
```

### Environment Variables

| Variable          | Purpose                     | Fallback             |
| ----------------- | --------------------------- | -------------------- |
| `DISCORD_TOKEN`   | Bot authentication          | _(required)_         |
| `LOGGING_CHANNEL` | Fallback logging channel ID | _(optional)_         |
| `SENTRY_DSN`      | Error tracking endpoint     | _(disabled if null)_ |
| `DATABASE_URL`    | SQLite file path            | `./data/data.db`     |
| `OWNER_IDS`       | Superuser Discord IDs (CSV) | _(optional)_         |

## Concurrency and State Management

**Single-Process Architecture**: No clustering; Discord.js client runs in one event loop.

**SQLite WAL Mode**: Concurrent reads; single writer. Atomic transactions via `db.transaction()`.

**Race Condition Prevention**:

```typescript
// Claim application atomically
db.transaction(() => {
  const app = db.prepare("SELECT claimed_by FROM review_action WHERE id = ?").get(appId);
  if (app.claimed_by !== null) throw new Error("Already claimed");
  db.prepare("UPDATE review_action SET claimed_by = ? WHERE id = ?").run(modId, appId);
})();
```

## Actionable Recommendations

### Architecture

- Add retry logic to Discord API calls (DM sends, embed posts) with exponential backoff
- Circuit breaker for Sentry -- disable after N consecutive 403s
- Centralize config access in a `ConfigManager` class that caches guild configs in memory

### Observability

- Replace `console.log` with structured JSON logs (include `timestamp`, `level`, `action`, `userId`)
- HTTP health check endpoint on port 3000 returning `/health` (uptime, DB stats, last event timestamp)
- OpenTelemetry spans on all command invocations to measure latency and find bottlenecks

### Database

- Add indexes on `review_action.claimed_by`, `action_log.timestamp`, `open_modmail.user_id`
- Weekly vacuum: `sqlite3 data.db "VACUUM;"` to reclaim space
- DB migrations framework to track applied migrations in `schema_migrations` table

### Error Recovery

- If logging channel is unreachable, queue cards in DB (`pending_logs` table) and retry on next boot
- Auto-retry modmail thread creation on 50013 failure; log warning and notify admin channel
- Validate bot permissions in review/modmail/logging channels at startup; exit if missing

---

## See Also

- [Database Schema](../reference/database-schema.md) — full table definitions for `configs`, `review_action`, `action_log`, `open_modmail`
- [Gate Review Flow](../reference/gate-review-flow.md) — step-by-step state machine for the application lifecycle shown above
- [Modmail System](../reference/modmail-system.md) — feature-level details on the modmail routing diagram
- [Logging and ModStats](../reference/logging-and-modstats.md) — what the analytics module reads and how stats are computed
- [Deployment Config](../operations/deployment-config.md) — how the runtime is configured and deployed
- [Troubleshooting](../operations/troubleshooting.md) — incident response for the failure modes called out in the Known Issues blocks above
