# Data Models - Pawtropolis Tech

> Auto-generated project documentation | 2026-03-01 | Exhaustive Scan

## Overview

- **Database**: SQLite (better-sqlite3)
- **Location**: `./data/data.db`
- **Mode**: WAL (Write-Ahead Logging)
- **Migrations**: 45 versioned files in `migrations/`
- **Total Tables**: 30+
- **Query Pattern**: Prepared statements via `db.prepare()` (no ORM)
- **Foreign Keys**: Enabled (`PRAGMA foreign_keys = ON`)
- **Busy Timeout**: 5000ms

## Schema by Feature Area

### Application Review Pipeline

#### `application`
| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | TEXT | PRIMARY KEY | Application UUID |
| guild_id | TEXT | NOT NULL | Discord guild ID |
| user_id | TEXT | NOT NULL | Applicant user ID |
| status | TEXT | NOT NULL DEFAULT 'draft' | draft, submitted, needs_info, approved, rejected, kicked |
| submitted_at | TEXT | | Submission timestamp |
| updated_at | TEXT | | Last update timestamp |
| permanently_rejected | INTEGER | DEFAULT 0 | Permanent rejection flag |
| created_at | TEXT | DEFAULT datetime('now') | Creation timestamp |

#### `application_response`
| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Row ID |
| app_id | TEXT | NOT NULL, FK → application(id) CASCADE | Parent application |
| q_index | INTEGER | NOT NULL | Question index (0-4) |
| question | TEXT | NOT NULL | Question text |
| answer | TEXT | NOT NULL | User's answer |
| created_at | TEXT | DEFAULT datetime('now') | Timestamp |

#### `avatar_scan`
| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| application_id | TEXT | PRIMARY KEY, FK → application(id) CASCADE | Application reference |
| avatar_url | TEXT | | Avatar URL scanned |
| nsfw_score | REAL | DEFAULT NULL | NSFW likelihood score |
| edge_score | REAL | DEFAULT 0 | Edge content score |
| final_pct | INTEGER | DEFAULT 0 | Final risk percentage |
| furry_score | REAL | DEFAULT 0 | Furry content score |
| scalie_score | REAL | DEFAULT 0 | Scalie content score |
| reason | TEXT | | Flagging reason |
| evidence_hard | TEXT | | Hard evidence details |
| evidence_soft | TEXT | | Soft evidence details |
| evidence_safe | TEXT | | Safe evidence details |
| scanned_at | TEXT | | Scan timestamp |
| updated_at | INTEGER | DEFAULT unixepoch() | Update timestamp |

#### `review_card`
| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| app_id | TEXT | PRIMARY KEY, FK → application(id) CASCADE | Application reference |
| channel_id | TEXT | NOT NULL | Discord channel containing review card |
| message_id | TEXT | NOT NULL | Discord message ID of review card |
| updated_at | TEXT | DEFAULT datetime('now') | Update timestamp |

#### `review_claim`
| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| app_id | TEXT | PRIMARY KEY, FK → application(id) CASCADE | Application reference |
| reviewer_id | TEXT | NOT NULL | Claiming moderator's user ID |
| claimed_at | TEXT | NOT NULL | Claim timestamp |

#### `review_action`
| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Row ID |
| app_id | TEXT | NOT NULL, FK → application(id) CASCADE | Application reference |
| moderator_id | TEXT | NOT NULL | Acting moderator |
| action | TEXT | NOT NULL | Free-text action type |
| reason | TEXT | | Action reason |
| message_link | TEXT | | Link to Discord message |
| meta | TEXT | | JSON metadata |
| created_at | INTEGER | DEFAULT strftime('%s','now') | Unix epoch timestamp |

#### `app_short_codes`
| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| app_id | TEXT | PRIMARY KEY, FK → application(id) CASCADE | Application reference |
| guild_id | TEXT | NOT NULL | Guild ID |
| code | TEXT | UNIQUE | HEX6 short code for O(1) lookup |
| created_at | INTEGER | DEFAULT strftime('%s','now') | Creation timestamp |

#### `transcript`
| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Row ID |
| app_id | TEXT | NOT NULL, FK → application(id) CASCADE | Application reference |
| ts | TEXT | NOT NULL | Timestamp |
| author_id | TEXT | NOT NULL | Message author |
| source | TEXT | NOT NULL | Message source |
| content | TEXT | NOT NULL | Message content |

### Modmail System

#### `modmail_ticket`
| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Ticket ID |
| guild_id | TEXT | NOT NULL | Guild ID |
| user_id | TEXT | NOT NULL | User who initiated |
| app_code | TEXT | | Link to application |
| review_message_id | TEXT | | Review message reference |
| thread_id | TEXT | | Thread ID |
| thread_channel_id | TEXT | | Thread channel ID |
| status | TEXT | NOT NULL DEFAULT 'open' | open or closed |
| log_channel_id | TEXT | | Log channel |
| log_message_id | TEXT | | Log message |
| created_at | TEXT | DEFAULT datetime('now') | Creation timestamp |
| closed_at | TEXT | | Closure timestamp |

#### `modmail_message`
| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Message ID |
| ticket_id | INTEGER | NOT NULL, FK → modmail_ticket(id) CASCADE | Parent ticket |
| direction | TEXT | NOT NULL CHECK(IN ('to_user','to_staff')) | Message direction |
| thread_message_id | TEXT | UNIQUE | Thread-side message ID |
| dm_message_id | TEXT | UNIQUE | DM-side message ID |
| reply_to_thread_message_id | TEXT | | Reply target (thread) |
| reply_to_dm_message_id | TEXT | | Reply target (DM) |
| content | TEXT | | Message content |
| created_at | TEXT | DEFAULT datetime('now') | Timestamp |

### Configuration

#### `guild_config`
Primary per-guild configuration table with 30+ columns including:
- **Logging**: logging_channel_id, notification_channel_id
- **Gate Settings**: gate_answer_max_length, silent_first_msg_days
- **Modmail**: modmail_log_channel_id, support_channel_id
- **Forum**: forum_channel_id, notify_role_id, notify_mode, notify_cooldown_seconds
- **Avatar Scanning**: avatar_scan_weight_model, avatar_scan_weight_edge, thresholds
- **Roles**: mod_role_ids, gatekeeper_role_id, bot_dev_role_id
- **Advanced**: retry config, circuit breaker, flag rate limiting
- **Report**: report_forum_id

#### `guild_question`
| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| guild_id | TEXT | NOT NULL, FK → guild_config(guild_id) CASCADE | Guild reference |
| q_index | INTEGER | NOT NULL CHECK(0-4) | Question index (max 5) |
| prompt | TEXT | NOT NULL | Question text |
| required | INTEGER | DEFAULT 1 | Required flag |

### Events & Attendance

#### `movie_attendance`
| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Row ID |
| guild_id | TEXT | NOT NULL | Guild ID |
| user_id | TEXT | NOT NULL | User ID |
| event_date | TEXT | NOT NULL | Event date |
| voice_channel_id | TEXT | NOT NULL | Voice channel |
| duration_minutes | INTEGER | NOT NULL | Total duration |
| longest_session_minutes | INTEGER | NOT NULL | Longest session |
| qualified | INTEGER | DEFAULT 0 | Met threshold |
| event_type | TEXT | DEFAULT 'movie' | movie or game |
| event_start_time | INTEGER | | Event start |
| event_end_time | INTEGER | | Event end |
| adjustment_type | TEXT | DEFAULT 'automatic' | automatic or manual |
| adjusted_by | TEXT | | Manual adjuster |
| adjustment_reason | TEXT | | Adjustment reason |
| created_at | INTEGER | DEFAULT strftime('%s','now') | Timestamp |

#### `active_movie_events`
Persists currently active events for crash recovery.

#### `active_movie_sessions`
Per-user session timing during active events (accumulated minutes, longest session).

#### `guild_movie_config` / `guild_game_config`
Per-guild event settings (qualification thresholds, attendance modes).

### Role Automation

#### `role_tiers`
Configurable tier mappings (guild_id, tier_type, tier_name, role_id, threshold).

#### `level_rewards`
Roles granted at each level (guild_id, level, role_id, role_name).

#### `role_assignments`
Audit trail of all role changes (action, reason, triggered_by, details JSON).

### Artist System

#### `artist_queue`
| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Row ID |
| guild_id | TEXT | NOT NULL | Guild ID |
| user_id | TEXT | NOT NULL | Artist user ID |
| position | INTEGER | NOT NULL | Queue position |
| added_at | TEXT | DEFAULT datetime('now') | Added timestamp |
| assignments_count | INTEGER | DEFAULT 0 | Total assignments |
| last_assigned_at | TEXT | | Last assignment |
| skipped | INTEGER | DEFAULT 0 | Skip flag |
| skip_reason | TEXT | | Skip reason |

#### `art_job`
| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Job ID |
| guild_id | TEXT | NOT NULL | Guild ID |
| job_number | INTEGER | NOT NULL | Global job number |
| artist_id | TEXT | NOT NULL | Assigned artist |
| artist_job_number | INTEGER | NOT NULL | Per-artist job number |
| recipient_id | TEXT | NOT NULL | Art recipient |
| ticket_type | TEXT | NOT NULL | Art type |
| status | TEXT | DEFAULT 'assigned' | assigned, completed, cancelled |
| assigned_at | TEXT | DEFAULT datetime('now') | Assignment timestamp |
| completed_at | TEXT | | Completion timestamp |
| notes | TEXT | | Job notes |

#### `artist_assignment_log`
Audit trail for all art assignments (artist_id, recipient_id, ticket_type, assigned_by).

### Moderation & Analytics

#### `action_log`
Complete audit log of all moderation actions with composite indexes for efficient querying.

#### `mod_metrics`
Computed moderator performance (claims, accepts, rejects, kicks, response times with percentiles).

#### `metrics_epoch`
Reset metrics without deleting historical data.

#### `user_activity`
Per-guild user tracking (joined_at, first_message_at, flagged_at, manual_flag, flagged_by).

#### `message_activity`
Hourly bucketed message tracking for activity heatmaps.

#### `user_cache`
Cached Discord user identity to avoid API rate limits.

### Content Safety

#### `nsfw_flags`
NSFW avatar flagging audit trail (nsfw_score, reason, reviewed status).

#### `ai_detection_toggles`
Per-guild AI detection service toggles (service name, enabled flag).

### Audit & Security

#### `audit_sessions`
Resumable audit session tracking (type, scope, status, progress counts).

#### `audit_scanned_users`
Prevents duplicate scans on audit resume.

#### `security_audit_snapshots`
Full security snapshots (roles, channels, issues as JSON) with content hashing for diff detection.

#### `security_issue_history`
Historical trend tracking for security issue counts by severity.

#### `acknowledged_security_issues`
Intentionally acknowledged security issues with permission hashing.

#### `bot_permission_requirements`
Documented expected bot permissions per guild.

#### `audit_findings`
Command audit test results (test_status, issue_severity, response_time, API costs).

### Health & Operations

#### `health_alerts`
Health check alerts with lifecycle (triggered, acknowledged, resolved).

#### `db_backups`
Backup metadata and validation (path, size, integrity, checksum).

#### `sync_marker`
Singleton table for database freshness tracking between local/remote.

#### `bot_status`
Bot presence and status configuration.

#### `active_byte_multipliers`
Active XP multiplier tokens with expiration tracking.

#### `schema_migrations`
Applied migration tracking (version, name, applied_at).

## Data Flow Patterns

### Application Review Flow
```
Discord Gate → INSERT application (draft)
→ INSERT application_response (answers)
→ Avatar scan → INSERT avatar_scan
→ Moderator claims → INSERT review_claim
→ Decision → INSERT review_action, UPDATE application.status
→ INSERT review_card (message location)
→ Optional: INSERT modmail_ticket
```

### Event Attendance Flow
```
Staff starts event → INSERT active_movie_events
→ User joins VC → INSERT active_movie_sessions
→ Periodic flush → UPDATE accumulated_minutes
→ Event ends → INSERT movie_attendance (final)
→ Qualification check → role_assignments
```

### Artist Rotation Flow
```
Staff assigns ticket → SELECT next from artist_queue
→ INSERT artist_assignment_log
→ INSERT art_job (status=assigned)
→ Artist completes → UPDATE art_job (status=completed)
→ UPDATE artist_queue positions
```

## Performance Indexes

### Critical Composite Indexes
- `action_log(guild_id, action, created_at_s)`
- `action_log(actor_id, action, created_at_s DESC)`
- `action_log(guild_id, app_id, created_at_s DESC)`
- `application(guild_id, status, created_at)`
- `modmail_ticket(guild_id, status)`
- `review_action(app_id, created_at_s DESC)`
- `movie_attendance(guild_id, user_id)`
- `security_audit_snapshots(guild_id, created_at DESC)`

### Partial Indexes
- `modmail_ticket(guild_id, user_id, status) WHERE status='open'`
- `user_activity(guild_id, flagged_at) WHERE flagged_at IS NOT NULL`
- `health_alerts(resolved_at) WHERE resolved_at IS NULL`

## Migration Strategy

- All migrations use `IF NOT EXISTS` or column existence checks (idempotent)
- Each migration runs in an explicit transaction (all-or-nothing)
- Foreign keys enforced globally
- Tracked in `schema_migrations` table
- No stored procedures; all logic in TypeScript
- Mixed timestamp formats: ISO8601 TEXT and INTEGER Unix epoch (being standardized to INTEGER)

## Cross-Reference

- Detailed existing schema reference: [docs/reference/database-schema.md](./reference/database-schema.md)
- Migration files: `migrations/001-045`
- Database layer: `src/db/db.ts`, `src/db/ensure.ts`
- System architecture context: [docs/architecture/system-overview.md](./architecture/system-overview.md)
- Gate review flow that drives `review_action` and `action_log`: [docs/reference/gate-review-flow.md](./reference/gate-review-flow.md)
- Modmail system that drives `open_modmail`: [docs/reference/modmail-system.md](./reference/modmail-system.md)
- ModStats that read from `action_log`: [docs/reference/logging-and-modstats.md](./reference/logging-and-modstats.md)
