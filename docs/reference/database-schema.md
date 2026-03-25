# Database Schema

The bot uses SQLite stored at `./data/data.db`. All timestamps are ISO 8601 format. Discord IDs are stored as TEXT.

## Main Tables

### configs
Stores server settings.

```sql
CREATE TABLE configs (
  guild_id TEXT PRIMARY KEY,
  review_channel_id TEXT,
  modmail_channel_id TEXT,
  member_role_id TEXT,
  moderator_role_id TEXT,
  acceptance_message TEXT,
  rejection_message TEXT,
  auto_kick_rejected INTEGER DEFAULT 0,
  require_claim INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**Note:** `logging_channel_id` column added by migration 001.

### review_action
Stores join applications.

```sql
CREATE TABLE review_action (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  age INTEGER NOT NULL,
  reason TEXT NOT NULL,
  referral TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  claimed_by TEXT,
  claimed_at TEXT,
  decided_at TEXT,
  submitted_at TEXT NOT NULL,
  review_message_id TEXT,
  CHECK (status IN ('pending', 'accepted', 'rejected'))
);
```

### action_log
Logs all moderator actions.

```sql
CREATE TABLE action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER,
  thread_id TEXT,
  moderator_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  metadata TEXT,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (app_id) REFERENCES review_action(id) ON DELETE CASCADE
);
```

### open_modmail
Tracks modmail tickets.

```sql
CREATE TABLE open_modmail (
  thread_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  related_app_id INTEGER,
  created_at TEXT NOT NULL,
  closed_at TEXT,
  closed_by TEXT,
  reopened_at TEXT,
  transcript TEXT,
  FOREIGN KEY (related_app_id) REFERENCES review_action(id) ON DELETE SET NULL
);
```

### user_activity
Tracks join times and flags for bot detection.

```sql
CREATE TABLE user_activity (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  first_message_at INTEGER,
  flagged_at INTEGER,
  flagged_reason TEXT,
  manual_flag INTEGER DEFAULT 0,
  flagged_by TEXT,
  PRIMARY KEY (guild_id, user_id)
);
```

### qotd_suggestion
Stores member-submitted QOTD questions and their review status.

```sql
CREATE TABLE qotd_suggestion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  question TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  short_code TEXT,
  review_message_id TEXT,
  reviewed_by TEXT,
  reviewed_at_s INTEGER,
  reject_reason TEXT,
  used_by TEXT,
  used_at_s INTEGER,
  created_at_s INTEGER NOT NULL,
  CHECK (status IN ('pending', 'approved', 'rejected', 'used'))
);
```

**Notes:**
- `status` tracks the suggestion lifecycle: `pending` -> `approved` -> `used`, or `pending` -> `rejected`
- `short_code` is a unique identifier for internal tracking (same format as application short codes)
- `review_message_id` references the review card in the QOTD review channel
- `reviewed_by` and `reviewed_at_s` record who approved/rejected and when
- `reject_reason` is populated when a suggestion is rejected (from the rejection modal)
- `used_by` and `used_at_s` record who pulled the question and when
- Requires `qotd_review_channel_id` in `guild_config` for review card posting

### level_reward_granted
Tracks which level rewards have been granted to prevent duplicates. Added by migration 057 to resolve INC-005.

```sql
CREATE TABLE level_reward_granted (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  level INTEGER NOT NULL,
  granted_at_s INTEGER NOT NULL,
  UNIQUE(guild_id, user_id, level)
);
```

**Notes:**
- The `UNIQUE(guild_id, user_id, level)` constraint enforces at the schema level that a user can only receive rewards for a given level once
- Grant logic uses `INSERT OR IGNORE` — if the row already exists, the insert silently fails and no rewards are processed
- Migration 057 backfills all historical grants from `role_assignments` to cover pre-fix grants
- Replaces the old time-windowed dedup approach that was vulnerable to TOCTOU races

## Running Migrations

Migrations are in `migrations/` folder with numbered files like `033_audit_sessions.ts`.

Run them with:
```bash
npm run migrate
```

## Common Queries

**Pending applications:**
```sql
SELECT * FROM review_action WHERE status = 'pending' AND claimed_by IS NULL;
```

**Moderator stats:**
```sql
SELECT moderator_id, COUNT(*) as actions
FROM action_log
WHERE action IN ('accept', 'reject')
GROUP BY moderator_id;
```

**Open modmail tickets:**
```sql
SELECT * FROM open_modmail WHERE status = 'open';
```

## Migration Notes

The `logging_channel_id` column was added by migration 001 (`migrations/001_add_logging_channel_id.ts`).
