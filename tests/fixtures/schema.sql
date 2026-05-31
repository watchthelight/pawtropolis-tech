-- Auto-generated schema dump (CI test fixture). DO NOT hand-edit.
-- Tables + indexes + triggers + views, no data. Sorted by type then name.
-- Regenerate with: npm run gen:test-schema (see scripts/gen-test-schema.ts).

-- ---------------------------------------------------------------------------
-- Stats Observatory rollup tables (migration 078_public_stats_rollups).
-- Added by hand here so the in-memory test DB has them, because gen:test-schema
-- requires a fully-migrated source DB and the prod migration runner is pending
-- (#00046). A future gen:test-schema run will reproduce these in sorted order.
-- These tables carry no foreign keys, so their position in the file is safe.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_heatmap (
      guild_id  TEXT NOT NULL,
      dow       INTEGER NOT NULL,
      hour      INTEGER NOT NULL,
      msg_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, dow, hour)
    );
CREATE TABLE IF NOT EXISTS channel_daily (
      guild_id     TEXT NOT NULL,
      day          TEXT NOT NULL,
      channel_id   TEXT NOT NULL,
      channel_name TEXT,
      msg_count    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, day, channel_id)
    );
CREATE TABLE IF NOT EXISTS cohort_retention (
      guild_id    TEXT NOT NULL,
      cohort_week TEXT NOT NULL,
      week_offset INTEGER NOT NULL,
      cohort_size INTEGER NOT NULL,
      retained    INTEGER NOT NULL,
      PRIMARY KEY (guild_id, cohort_week, week_offset)
    );
CREATE TABLE IF NOT EXISTS daily_metrics (
      guild_id            TEXT NOT NULL,
      day                 TEXT NOT NULL,
      member_count        INTEGER,
      member_count_delta  INTEGER,
      joins               INTEGER NOT NULL DEFAULT 0,
      leaves              INTEGER NOT NULL DEFAULT 0,
      cumulative_net      INTEGER,
      message_count       INTEGER NOT NULL DEFAULT 0,
      message_count_prev7 INTEGER,
      active_authors      INTEGER NOT NULL DEFAULT 0,
      active_authors_7d   INTEGER,
      voice_minutes       INTEGER NOT NULL DEFAULT 0,
      dec_approve         INTEGER NOT NULL DEFAULT 0,
      dec_reject          INTEGER NOT NULL DEFAULT 0,
      dec_kick            INTEGER NOT NULL DEFAULT 0,
      apps_submitted      INTEGER NOT NULL DEFAULT 0,
      apps_approved       INTEGER NOT NULL DEFAULT 0,
      refreshed_at_s      INTEGER NOT NULL,
      PRIMARY KEY (guild_id, day)
    );
CREATE TABLE IF NOT EXISTS event_daily (
      guild_id        TEXT NOT NULL,
      event_date      TEXT NOT NULL,
      event_type      TEXT NOT NULL,
      qualified_count INTEGER NOT NULL DEFAULT 0,
      total_count     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, event_date, event_type)
    );
CREATE TABLE IF NOT EXISTS mod_leaderboard (
      guild_id      TEXT NOT NULL,
      moderator_id  TEXT NOT NULL,
      display_label TEXT,
      accepts       INTEGER NOT NULL DEFAULT 0,
      rejects       INTEGER NOT NULL DEFAULT 0,
      kicks         INTEGER NOT NULL DEFAULT 0,
      p50_s         REAL,
      p95_s         REAL,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, moderator_id)
    );
CREATE TABLE IF NOT EXISTS qotd_weekly (
      guild_id  TEXT NOT NULL,
      week      TEXT NOT NULL,
      submitted INTEGER NOT NULL DEFAULT 0,
      approved  INTEGER NOT NULL DEFAULT 0,
      used      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, week)
    );
CREATE TABLE IF NOT EXISTS reaction_emoji (
      guild_id TEXT NOT NULL,
      emoji    TEXT NOT NULL,
      count    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, emoji)
    );
CREATE TABLE IF NOT EXISTS rollup_meta (
      guild_id       TEXT PRIMARY KEY,
      refreshed_at_s INTEGER NOT NULL
    );
CREATE TABLE IF NOT EXISTS tenure_buckets (
      guild_id     TEXT NOT NULL,
      bucket       TEXT NOT NULL,
      member_count INTEGER NOT NULL DEFAULT 0,
      sort_order   INTEGER NOT NULL,
      PRIMARY KEY (guild_id, bucket)
    );
CREATE TABLE IF NOT EXISTS acknowledged_security_issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        issue_key TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        permission_hash TEXT NOT NULL,
        acknowledged_by TEXT NOT NULL,
        acknowledged_at INTEGER NOT NULL,
        reason TEXT,
        UNIQUE(guild_id, issue_key)
      );
CREATE TABLE IF NOT EXISTS action_log (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id      TEXT NOT NULL,
          app_id        TEXT,
          app_code      TEXT,
          actor_id      TEXT NOT NULL,
          subject_id    TEXT,
          action        TEXT NOT NULL,
          reason        TEXT,
          meta_json     TEXT,
          created_at_s  INTEGER NOT NULL
        );
CREATE VIRTUAL TABLE action_log_fts USING fts5(
      reason, app_code, actor_id, subject_id,
      content='action_log',
      content_rowid='id',
      tokenize='porter unicode61'
    );
CREATE TABLE IF NOT EXISTS active_byte_multipliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        -- Guild and user identification
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,

        -- Multiplier role details
        multiplier_role_id TEXT NOT NULL,
        multiplier_name TEXT NOT NULL,
        multiplier_value INTEGER NOT NULL,

        -- Expiration tracking
        expires_at INTEGER NOT NULL,

        -- Audit trail
        token_rarity TEXT NOT NULL CHECK(token_rarity IN (
          'common',
          'rare',
          'epic',
          'legendary',
          'mythic'
        )),
        redeemed_by TEXT NOT NULL,

        -- Timestamp
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),

        -- One active multiplier per user per guild
        UNIQUE(guild_id, user_id)
      );
CREATE TABLE IF NOT EXISTS active_movie_events (
        guild_id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        event_date TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      , event_type TEXT DEFAULT 'movie');
CREATE TABLE IF NOT EXISTS active_movie_sessions (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        event_date TEXT NOT NULL,
        current_session_start INTEGER,
        accumulated_minutes INTEGER DEFAULT 0,
        longest_session_minutes INTEGER DEFAULT 0,
        last_persisted_at INTEGER NOT NULL, event_type TEXT DEFAULT 'movie',
        PRIMARY KEY (guild_id, user_id, event_date)
      );
CREATE TABLE IF NOT EXISTS ai_detection_toggles (
        guild_id TEXT NOT NULL,
        service TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (guild_id, service)
      );
CREATE TABLE IF NOT EXISTS app_short_codes (
      app_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      code TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),

      PRIMARY KEY (app_id),
      UNIQUE (code),

      FOREIGN KEY (app_id) REFERENCES application(id) ON DELETE CASCADE
    ) STRICT;
CREATE TABLE IF NOT EXISTS application (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  status   TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected','needs_info','kicked')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT,
  resolved_at  TEXT,
  resolver_id  TEXT,
  resolution_reason TEXT, perma_rejected INTEGER NOT NULL DEFAULT 0, permanently_rejected INTEGER NOT NULL DEFAULT 0, permanent_reject_at TEXT, stale_alert_sent INTEGER NOT NULL DEFAULT 0, stale_alert_sent_at TEXT,
  FOREIGN KEY (guild_id) REFERENCES guild_config(guild_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS application_response (app_id TEXT NOT NULL, q_index INTEGER NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (app_id, q_index), FOREIGN KEY (app_id) REFERENCES application(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS art_job (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    job_number INTEGER NOT NULL,
    artist_id TEXT NOT NULL,
    artist_job_number INTEGER NOT NULL,
    recipient_id TEXT NOT NULL,
    ticket_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'assigned',
    assigned_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    notes TEXT,
    assignment_log_id INTEGER, ticket_id TEXT, thumbnail_url TEXT,
    UNIQUE(guild_id, job_number)
  );
CREATE TABLE IF NOT EXISTS artist_assignment_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    artist_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    ticket_type TEXT NOT NULL,
    ticket_role_id TEXT,
    assigned_by TEXT NOT NULL,
    assigned_at TEXT DEFAULT (datetime('now')),
    channel_id TEXT,
    override INTEGER DEFAULT 0
  );
CREATE TABLE IF NOT EXISTS artist_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    added_at TEXT DEFAULT (datetime('now')),
    assignments_count INTEGER DEFAULT 0,
    last_assigned_at TEXT,
    skipped INTEGER DEFAULT 0,
    skip_reason TEXT,
    UNIQUE(guild_id, user_id)
  );
CREATE TABLE IF NOT EXISTS audit_findings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        -- Audit session identification
        audit_run_id TEXT NOT NULL,

        -- Command identification
        command_name TEXT NOT NULL,
        subcommand TEXT,

        -- Test execution results
        test_status TEXT NOT NULL CHECK(test_status IN (
          'pass',
          'fail',
          'error',
          'skipped',
          'not_tested'
        )),
        test_type TEXT NOT NULL CHECK(test_type IN (
          'live',
          'mock',
          'manual',
          'api_limited'
        )),

        -- Issue tracking (nullable - not all tests find issues)
        issue_severity TEXT CHECK(issue_severity IN (
          'critical',
          'high',
          'medium',
          'low',
          'info'
        )),
        issue_category TEXT,
        issue_title TEXT,
        issue_description TEXT,

        -- Response timing
        response_time_ms INTEGER,

        -- API usage tracking
        api_calls_made INTEGER NOT NULL DEFAULT 0,
        api_cost_estimate REAL NOT NULL DEFAULT 0.0,

        -- Documentation verification
        doc_file TEXT,
        doc_accurate INTEGER,
        doc_issue TEXT,

        -- Permission verification
        expected_permission TEXT,
        actual_permission TEXT,
        permission_match INTEGER,

        -- Additional context
        notes TEXT,

        -- Timestamp
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
CREATE TABLE IF NOT EXISTS audit_scanned_users (
    session_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (session_id, user_id)
  );
CREATE TABLE IF NOT EXISTS audit_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    audit_type TEXT NOT NULL,
    scope TEXT,
    status TEXT NOT NULL DEFAULT 'in_progress',
    started_by TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    total_to_scan INTEGER NOT NULL DEFAULT 0,
    scanned_count INTEGER NOT NULL DEFAULT 0,
    flagged_count INTEGER NOT NULL DEFAULT 0,
    api_calls INTEGER NOT NULL DEFAULT 0,
    channel_id TEXT NOT NULL
  );
CREATE TABLE IF NOT EXISTS avatar_scan (
  application_id TEXT PRIMARY KEY,
  avatar_url TEXT NOT NULL,
  nsfw_score REAL,
  skin_edge_score REAL,
  flagged INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT 'none',
  scanned_at TEXT NOT NULL
, final_pct INTEGER NOT NULL DEFAULT 0, app_id TEXT, edge_score REAL DEFAULT 0, furry_score REAL DEFAULT 0, scalie_score REAL DEFAULT 0, updated_at INTEGER, evidence_hard TEXT, evidence_soft TEXT, evidence_safe TEXT, banner_url TEXT, banner_nsfw_score REAL, banner_final_pct INTEGER DEFAULT 0, banner_reason TEXT, banner_evidence_hard TEXT, banner_evidence_soft TEXT, banner_evidence_safe TEXT, avatar_ai_score REAL, banner_ai_score REAL);
CREATE TABLE IF NOT EXISTS backfill_progress (
        channel_id        TEXT PRIMARY KEY,
        guild_id          TEXT NOT NULL,
        channel_name      TEXT NOT NULL,
        oldest_seen_id    TEXT,
        oldest_seen_ts    INTEGER,
        newest_seen_id    TEXT,
        newest_seen_ts    INTEGER,
        messages_fetched  INTEGER NOT NULL DEFAULT 0,
        reactions_fetched INTEGER NOT NULL DEFAULT 0,
        status            TEXT NOT NULL DEFAULT 'pending',
        last_error        TEXT,
        started_at_s      INTEGER,
        completed_at_s    INTEGER,
        updated_at_s      INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
CREATE TABLE IF NOT EXISTS backfill_stats (
        id                  INTEGER PRIMARY KEY CHECK (id = 1),
        started_at_s        INTEGER,
        last_heartbeat_s    INTEGER,
        current_channel_id  TEXT,
        current_channel_name TEXT,
        messages_total      INTEGER NOT NULL DEFAULT 0,
        reactions_total     INTEGER NOT NULL DEFAULT 0,
        channels_total      INTEGER NOT NULL DEFAULT 0,
        channels_completed  INTEGER NOT NULL DEFAULT 0,
        msgs_per_sec        REAL NOT NULL DEFAULT 0,
        eta_seconds         INTEGER,
        disk_used_bytes     INTEGER,
        disk_total_bytes    INTEGER,
        iops_read           INTEGER,
        iops_write          INTEGER,
        process_state       TEXT NOT NULL DEFAULT 'idle'
      );
CREATE TABLE IF NOT EXISTS bot_permission_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT NOT NULL UNIQUE,
  bot_name TEXT NOT NULL,
  required_permissions TEXT NOT NULL,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
CREATE TABLE IF NOT EXISTS bot_status (
          scope_key TEXT NOT NULL PRIMARY KEY,
          activity_type INTEGER NOT NULL,
          activity_text TEXT NOT NULL,
          status TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        , custom_status TEXT);
CREATE TABLE IF NOT EXISTS channel_cache (
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type INTEGER NOT NULL,
      parent_id TEXT,
      updated_at_s INTEGER NOT NULL,
      PRIMARY KEY (guild_id, channel_id)
    );
CREATE TABLE IF NOT EXISTS config_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      field_key TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      source TEXT NOT NULL DEFAULT 'dashboard',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
CREATE TABLE IF NOT EXISTS db_backups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL,
        integrity_result TEXT,
        row_count INTEGER,
        checksum TEXT,
        verified_at INTEGER,
        notes TEXT
      );
CREATE TABLE IF NOT EXISTS general_messages_ctx (
    id       TEXT PRIMARY KEY,
    ctx_json TEXT NOT NULL
  );
CREATE TABLE IF NOT EXISTS general_messages_effort (
    id           TEXT PRIMARY KEY,
    created_at_s INTEGER NOT NULL,
    score        REAL NOT NULL,
    model        TEXT NOT NULL
  );
CREATE TABLE IF NOT EXISTS general_messages_embed (
    id            TEXT PRIMARY KEY,
    target_vec    BLOB NOT NULL,
    ctx_vec       BLOB NOT NULL,
    embedded_at_s INTEGER NOT NULL
  );
CREATE TABLE IF NOT EXISTS general_messages_gold (
    id            TEXT PRIMARY KEY,
    stratum_len   INTEGER NOT NULL,
    stratum_score INTEGER NOT NULL,
    selected_at_s INTEGER NOT NULL
  );
CREATE TABLE IF NOT EXISTS general_messages_label (
    id           TEXT PRIMARY KEY,
    density      REAL NOT NULL,
    specificity  REAL NOT NULL,
    sincerity    REAL NOT NULL,
    relevance    REAL NOT NULL,
    effort       REAL NOT NULL,
    rationale    TEXT NOT NULL,
    model        TEXT NOT NULL,
    in_tokens    INTEGER NOT NULL,
    out_tokens   INTEGER NOT NULL,
    cached_in    INTEGER NOT NULL DEFAULT 0,
    labeled_at_s INTEGER NOT NULL
  );
CREATE TABLE IF NOT EXISTS general_messages_raw (
    id            TEXT PRIMARY KEY,
    created_at_s  INTEGER NOT NULL,
    author_id     TEXT NOT NULL,
    is_bot        INTEGER NOT NULL,
    content       TEXT NOT NULL,
    attachments   INTEGER NOT NULL,
    embeds        INTEGER NOT NULL,
    reply_to      TEXT
  );
CREATE TABLE IF NOT EXISTS general_messages_resonance (
    id           TEXT PRIMARY KEY,
    created_at_s INTEGER NOT NULL,
    reply_count  INTEGER NOT NULL,
    score        REAL NOT NULL
  );
CREATE TABLE IF NOT EXISTS general_messages_score (
    id           TEXT PRIMARY KEY,
    created_at_s INTEGER NOT NULL,
    score        REAL NOT NULL,
    features     TEXT NOT NULL
  );
CREATE TABLE IF NOT EXISTS guild_config (
  guild_id TEXT PRIMARY KEY,
  review_channel_id     TEXT,
  gate_channel_id       TEXT,
  unverified_channel_id TEXT,
  general_channel_id    TEXT,
  accepted_role_id      TEXT,
  reviewer_role_id      TEXT,
  image_search_url_template TEXT NOT NULL DEFAULT 'https://lens.google.com/uploadbyurl?url={avatarUrl}',
  reapply_cooldown_hours   INTEGER NOT NULL DEFAULT 24 CHECK (reapply_cooldown_hours >= 0),
  min_account_age_hours    INTEGER NOT NULL DEFAULT 0 CHECK (min_account_age_hours >= 0),
  min_join_age_hours       INTEGER NOT NULL DEFAULT 0 CHECK (min_join_age_hours >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, avatar_scan_enabled INTEGER NOT NULL DEFAULT 0, avatar_scan_nsfw_threshold REAL NOT NULL DEFAULT 0.60, avatar_scan_skin_edge_threshold REAL NOT NULL DEFAULT 0.18, avatar_scan_weight_model REAL NOT NULL DEFAULT 0.7, avatar_scan_weight_edge REAL NOT NULL DEFAULT 0.3, welcome_template TEXT, info_channel_id TEXT, rules_channel_id TEXT, welcome_ping_role_id TEXT, mod_role_ids TEXT, gatekeeper_role_id TEXT, modmail_log_channel_id TEXT, review_roles_mode TEXT NOT NULL DEFAULT 'level_only', modmail_delete_on_close INTEGER DEFAULT 1, logging_channel_id TEXT, flags_channel_id TEXT, silent_first_msg_days INTEGER DEFAULT 90, dadmode_enabled INTEGER DEFAULT 0, dadmode_odds INTEGER DEFAULT 1000, listopen_public_output INTEGER DEFAULT 1, forum_channel_id TEXT, notify_role_id TEXT, notify_mode TEXT DEFAULT 'post', notification_channel_id TEXT, notify_cooldown_seconds INTEGER DEFAULT 5, notify_max_per_hour INTEGER DEFAULT 10, ping_dev_on_app INTEGER NOT NULL DEFAULT 1, panic_mode INTEGER NOT NULL DEFAULT 0, panic_enabled_at INTEGER, panic_enabled_by TEXT, updated_at_s INTEGER, suggestion_channel_id TEXT, suggestion_cooldown INTEGER DEFAULT 3600, artist_role_id TEXT, ambassador_role_id TEXT, server_artist_channel_id TEXT, artist_ticket_roles_json TEXT, support_channel_id TEXT, artist_ignored_users_json TEXT, backfill_notification_channel_id TEXT, bot_dev_role_id TEXT, gate_answer_max_length INTEGER, banner_sync_interval_minutes INTEGER, modmail_forward_max_size INTEGER, retry_max_attempts INTEGER, retry_initial_delay_ms INTEGER, retry_max_delay_ms INTEGER, circuit_breaker_threshold INTEGER, circuit_breaker_reset_ms INTEGER, avatar_scan_hard_threshold REAL, avatar_scan_soft_threshold REAL, avatar_scan_racy_threshold REAL, flag_rate_limit_ms INTEGER, flag_cooldown_ttl_ms INTEGER, banner_sync_enabled INTEGER DEFAULT 1, skullmode_enabled INTEGER DEFAULT 0, skullmode_odds INTEGER DEFAULT 1000, report_forum_id TEXT, nsfw_alert_role_id TEXT, qotd_review_channel_id TEXT, qotd_role_id TEXT, pulse_excluded_category_ids_json TEXT, vote_out_threshold INTEGER DEFAULT 2, admin_role_id TEXT, verify_thread_parent_id TEXT, unverified_rules_channel_id TEXT);
CREATE TABLE IF NOT EXISTS guild_game_config (
        guild_id TEXT PRIMARY KEY,
        qualification_percentage INTEGER DEFAULT 50,
        attendance_mode TEXT DEFAULT 'cumulative',
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
CREATE TABLE IF NOT EXISTS guild_movie_config (
        guild_id TEXT PRIMARY KEY,
        attendance_mode TEXT DEFAULT 'cumulative',
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      , qualification_threshold_minutes INTEGER DEFAULT 30);
CREATE TABLE IF NOT EXISTS "guild_question" (
      guild_id TEXT NOT NULL,
      q_index  INTEGER NOT NULL CHECK (q_index BETWEEN 0 AND 4),
      prompt   TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0,1)),
      PRIMARY KEY (guild_id, q_index),
      FOREIGN KEY (guild_id) REFERENCES guild_config(guild_id) ON DELETE CASCADE
    );
CREATE TABLE IF NOT EXISTS guild_snapshot (
      guild_id TEXT PRIMARY KEY,
      member_count INTEGER NOT NULL,
      online_count INTEGER,
      boost_count INTEGER,
      boost_tier INTEGER,
      channel_count INTEGER,
      role_count INTEGER,
      voice_users_now INTEGER,
      updated_at_s INTEGER NOT NULL
    );
CREATE TABLE IF NOT EXISTS guild_snapshot_log (
      guild_id TEXT NOT NULL,
      date TEXT NOT NULL,
      member_count INTEGER,
      online_count INTEGER,
      boost_count INTEGER,
      boost_tier INTEGER,
      voice_users_now INTEGER,
      PRIMARY KEY (guild_id, date)
    );
CREATE TABLE IF NOT EXISTS health_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  triggered_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  acknowledged_by TEXT,
  acknowledged_at INTEGER,
  resolved_by TEXT,
  resolved_at INTEGER,
  meta TEXT
);
CREATE TABLE IF NOT EXISTS invite_label (
      guild_id TEXT NOT NULL,
      invite_code TEXT NOT NULL,
      label TEXT NOT NULL,
      PRIMARY KEY (guild_id, invite_code)
    );
CREATE TABLE IF NOT EXISTS invite_snapshot (
      guild_id TEXT NOT NULL,
      invite_code TEXT NOT NULL,
      uses INTEGER NOT NULL DEFAULT 0,
      inviter_id TEXT,
      updated_at_s INTEGER NOT NULL,
      PRIMARY KEY (guild_id, invite_code)
    );
CREATE TABLE IF NOT EXISTS invite_usage (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      invite_code TEXT,
      inviter_id TEXT,
      joined_at_s INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
CREATE TABLE IF NOT EXISTS level_reward_granted (
        guild_id      TEXT NOT NULL,
        user_id       TEXT NOT NULL,
        level         INTEGER NOT NULL,
        granted_at_s  INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        UNIQUE(guild_id, user_id, level)
      );
CREATE TABLE IF NOT EXISTS level_rewards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        level INTEGER NOT NULL,
        role_id TEXT NOT NULL,
        role_name TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        UNIQUE(guild_id, level, role_id)
      );
CREATE TABLE IF NOT EXISTS lost_and_found(rootpgno INTEGER, pgno INTEGER, nfield INTEGER, id INTEGER, c0, c1, c2, c3, c4, c5, c6, c7);
CREATE TABLE IF NOT EXISTS member_role_snapshots (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id      TEXT NOT NULL,
        user_id       TEXT NOT NULL,
        role_ids      TEXT NOT NULL,
        removal_type  TEXT NOT NULL DEFAULT 'unknown',
        reason        TEXT,
        executor_id   TEXT,
        removed_at    INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        restored_at   INTEGER,
        restored_by   TEXT
      );
CREATE TABLE IF NOT EXISTS message_activity (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id      TEXT NOT NULL,
        channel_id    TEXT NOT NULL,
        user_id       TEXT NOT NULL,
        created_at_s  INTEGER NOT NULL,
        hour_bucket   INTEGER NOT NULL
      );
CREATE TABLE IF NOT EXISTS message_reactions_archive (
        message_id     TEXT NOT NULL,
        emoji          TEXT NOT NULL,
        user_id        TEXT NOT NULL,
        reacted_at_s   INTEGER,
        ingest_source  TEXT NOT NULL DEFAULT 'live',
        PRIMARY KEY (message_id, emoji, user_id)
      );
CREATE TABLE IF NOT EXISTS messages_archive (
        message_id        TEXT PRIMARY KEY,
        guild_id          TEXT NOT NULL,
        channel_id        TEXT NOT NULL,
        thread_id         TEXT,
        author_id         TEXT NOT NULL,
        author_name       TEXT NOT NULL,
        author_is_bot     INTEGER NOT NULL DEFAULT 0,
        content           TEXT NOT NULL DEFAULT '',
        attachments_json  TEXT,
        embeds_json       TEXT,
        reply_to_id       TEXT,
        is_edited         INTEGER NOT NULL DEFAULT 0,
        is_deleted        INTEGER NOT NULL DEFAULT 0,
        created_at_s      INTEGER NOT NULL,
        edited_at_s       INTEGER,
        deleted_at_s      INTEGER,
        ingested_at_s     INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        ingest_source     TEXT NOT NULL DEFAULT 'live'
      );
CREATE TABLE IF NOT EXISTS metrics_epoch (
        guild_id   TEXT PRIMARY KEY,
        start_at   TEXT NOT NULL
      );
CREATE TABLE IF NOT EXISTS mod_metrics (
          moderator_id        TEXT NOT NULL,
          guild_id            TEXT NOT NULL,
          total_claims        INTEGER NOT NULL DEFAULT 0,
          total_accepts       INTEGER NOT NULL DEFAULT 0,
          total_rejects       INTEGER NOT NULL DEFAULT 0,
          total_kicks         INTEGER NOT NULL DEFAULT 0,
          total_modmail_opens INTEGER NOT NULL DEFAULT 0,
          avg_response_time_s REAL DEFAULT NULL,
          p50_response_time_s REAL DEFAULT NULL,
          p95_response_time_s REAL DEFAULT NULL,
          updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (moderator_id, guild_id)
        );
CREATE TABLE IF NOT EXISTS modmail_bridge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at  TEXT
);
CREATE TABLE IF NOT EXISTS modmail_message (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL,
    direction TEXT NOT NULL,
    thread_message_id TEXT,
    dm_message_id TEXT,
    reply_to_thread_message_id TEXT,
    reply_to_dm_message_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), content TEXT,
    UNIQUE(thread_message_id),
    UNIQUE(dm_message_id)
  );
CREATE TABLE IF NOT EXISTS modmail_ticket (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    app_code TEXT,
    review_message_id TEXT,
    thread_id TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT
  , log_message_id TEXT, log_channel_id TEXT, thread_channel_id TEXT, bot_migration_notified_at TEXT);
CREATE TABLE IF NOT EXISTS movie_attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        event_date TEXT NOT NULL,
        voice_channel_id TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL,
        longest_session_minutes INTEGER NOT NULL,
        qualified INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now')), adjustment_type TEXT DEFAULT 'automatic', adjusted_by TEXT, adjustment_reason TEXT, event_type TEXT DEFAULT 'movie', event_start_time INTEGER, event_end_time INTEGER,
        UNIQUE(guild_id, user_id, event_date, event_type)
      );

CREATE TABLE IF NOT EXISTS consumed_confirmations (
        confirm_id TEXT PRIMARY KEY,
        consumed_at_s INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );
CREATE TABLE IF NOT EXISTS nsfw_flags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        avatar_url TEXT NOT NULL,
        nsfw_score REAL NOT NULL,
        reason TEXT NOT NULL,
        flagged_by TEXT NOT NULL,
        flagged_at TEXT NOT NULL DEFAULT (datetime('now')),
        reviewed INTEGER NOT NULL DEFAULT 0, reviewed_by TEXT, reviewed_at TEXT,
        UNIQUE(guild_id, user_id)
      );
CREATE TABLE IF NOT EXISTS open_modmail (
        guild_id     TEXT NOT NULL,
        applicant_id TEXT NOT NULL,
        thread_id    TEXT NOT NULL,
        created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        PRIMARY KEY (guild_id, applicant_id)
      );
CREATE TABLE IF NOT EXISTS patreon_art_granted (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      art_type TEXT NOT NULL,
      quantity_granted INTEGER NOT NULL DEFAULT 0,
      quantity_redeemed INTEGER NOT NULL DEFAULT 0,
      last_granted_at_s INTEGER,
      UNIQUE(guild_id, user_id, art_type)
    );
CREATE TABLE IF NOT EXISTS patreon_art_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      art_type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      patreon_tier TEXT NOT NULL,
      reason TEXT,
      created_at_s INTEGER NOT NULL DEFAULT (unixepoch())
    );
CREATE TABLE IF NOT EXISTS qotd_suggestion (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id          TEXT NOT NULL,
        user_id           TEXT NOT NULL,
        question          TEXT NOT NULL,
        status            TEXT NOT NULL DEFAULT 'pending'
                          CHECK(status IN ('pending', 'approved', 'rejected', 'used')),
        short_code        TEXT NOT NULL,
        review_message_id TEXT,
        reviewed_by       TEXT,
        reviewed_at_s     INTEGER,
        reject_reason     TEXT,
        used_by           TEXT,
        used_at_s         INTEGER,
        created_at_s      INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
CREATE TABLE IF NOT EXISTS review_action (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        app_id        TEXT NOT NULL,
        moderator_id  TEXT NOT NULL,
        action        TEXT NOT NULL,
        reason        TEXT,
        message_link  TEXT,
        meta          TEXT,
        created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        FOREIGN KEY (app_id) REFERENCES application(id) ON DELETE CASCADE
      );
CREATE TABLE IF NOT EXISTS review_card (
  app_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (app_id) REFERENCES application(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS review_claim (
    app_id TEXT PRIMARY KEY,
    reviewer_id TEXT NOT NULL,
    claimed_at TEXT NOT NULL
  );
CREATE TABLE IF NOT EXISTS role_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        role_name TEXT,
        action TEXT NOT NULL,
        reason TEXT,
        triggered_by TEXT,
        details TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
CREATE TABLE IF NOT EXISTS role_cache (
      guild_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      mentionable INTEGER NOT NULL DEFAULT 0,
      managed INTEGER NOT NULL DEFAULT 0,
      updated_at_s INTEGER NOT NULL,
      PRIMARY KEY (guild_id, role_id)
    );
CREATE TABLE IF NOT EXISTS role_tiers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        tier_type TEXT NOT NULL,
        tier_name TEXT NOT NULL,
        role_id TEXT NOT NULL,
        threshold INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        UNIQUE(guild_id, tier_type, tier_name)
      );
CREATE TABLE IF NOT EXISTS schema_migrations (
          version     TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          applied_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        );
CREATE TABLE IF NOT EXISTS security_audit_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  role_count INTEGER NOT NULL,
  channel_count INTEGER NOT NULL,
  issue_count INTEGER NOT NULL,
  critical_count INTEGER NOT NULL DEFAULT 0,
  high_count INTEGER NOT NULL DEFAULT 0,
  medium_count INTEGER NOT NULL DEFAULT 0,
  low_count INTEGER NOT NULL DEFAULT 0,
  roles_snapshot TEXT NOT NULL,
  channels_snapshot TEXT NOT NULL,
  issues_snapshot TEXT NOT NULL,
  content_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS security_issue_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  recorded_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  critical_count INTEGER NOT NULL DEFAULT 0,
  high_count INTEGER NOT NULL DEFAULT 0,
  medium_count INTEGER NOT NULL DEFAULT 0,
  low_count INTEGER NOT NULL DEFAULT 0,
  acknowledged_count INTEGER NOT NULL DEFAULT 0,
  role_issues INTEGER NOT NULL DEFAULT 0,
  channel_issues INTEGER NOT NULL DEFAULT 0,
  hierarchy_issues INTEGER NOT NULL DEFAULT 0,
  verification_issues INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sync_marker (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_modified_at INTEGER NOT NULL,
    last_modified_by TEXT NOT NULL,
    action_count INTEGER NOT NULL DEFAULT 0,
    last_action_type TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );
CREATE TABLE IF NOT EXISTS testidea_state (
        guild_id     TEXT PRIMARY KEY,
        enabled      INTEGER NOT NULL DEFAULT 0,
        snapshot     TEXT,
        updated_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      , action_id TEXT);
CREATE TABLE IF NOT EXISTS ticket (
        id                    TEXT PRIMARY KEY,
        type_key              TEXT NOT NULL REFERENCES ticket_type(key),
        number                INTEGER NOT NULL,
        channel_id            TEXT NOT NULL UNIQUE,
        staff_thread_id       TEXT,
        guild_id              TEXT NOT NULL,
        opener_user_id        TEXT NOT NULL,
        claimed_by_user_id    TEXT,
        status                TEXT NOT NULL,
        close_reason          TEXT,
        closed_by_user_id     TEXT,
        archive_path          TEXT,
        legacy_source         TEXT,
        opened_at             INTEGER NOT NULL,
        claimed_at            INTEGER,
        closed_at             INTEGER, greeting_message_id TEXT,
        UNIQUE (type_key, number)
      );
CREATE TABLE IF NOT EXISTS ticket_attachment (
        id              TEXT PRIMARY KEY,
        message_id      TEXT NOT NULL REFERENCES ticket_message(id),
        ticket_id       TEXT NOT NULL REFERENCES ticket(id),
        filename        TEXT NOT NULL,
        mime            TEXT,
        size_bytes      INTEGER NOT NULL,
        local_path      TEXT,
        sha256          TEXT,
        original_url    TEXT NOT NULL,
        created_at      INTEGER NOT NULL DEFAULT (unixepoch())
      );
CREATE TABLE IF NOT EXISTS ticket_counter (
        key            TEXT PRIMARY KEY,
        current_value  INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL DEFAULT (unixepoch())
      );
CREATE TABLE IF NOT EXISTS ticket_event (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id       TEXT NOT NULL REFERENCES ticket(id),
        event_type      TEXT NOT NULL,
        actor_user_id   TEXT,
        payload_json    TEXT,
        created_at      INTEGER NOT NULL DEFAULT (unixepoch())
      );
CREATE TABLE IF NOT EXISTS ticket_message (
        id                     TEXT PRIMARY KEY,
        ticket_id              TEXT NOT NULL REFERENCES ticket(id),
        in_thread              INTEGER NOT NULL DEFAULT 0,
        author_user_id         TEXT NOT NULL,
        author_is_bot          INTEGER NOT NULL,
        content                TEXT,
        embeds_json            TEXT,
        reply_to_message_id    TEXT,
        created_at             INTEGER NOT NULL,
        edited_at              INTEGER,
        deleted_at             INTEGER
      );
CREATE TABLE IF NOT EXISTS ticket_seq (
    id INTEGER PRIMARY KEY AUTOINCREMENT
  );
CREATE TABLE IF NOT EXISTS ticket_type (
        key                    TEXT PRIMARY KEY,
        label                  TEXT NOT NULL,
        panel_stack            TEXT NOT NULL,
        panel_position         INTEGER NOT NULL,
        button_emoji           TEXT,
        button_style           INTEGER NOT NULL,
        embed_color            INTEGER NOT NULL,
        num_counter_key        TEXT NOT NULL,
        channel_name_template  TEXT NOT NULL,
        greeting_md            TEXT NOT NULL,
        ping_role_ids          TEXT NOT NULL,
        perm_template_json     TEXT NOT NULL,
        has_staff_thread       INTEGER NOT NULL DEFAULT 1,
        is_active              INTEGER NOT NULL DEFAULT 1,
        created_at             INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at             INTEGER NOT NULL DEFAULT (unixepoch())
      );
CREATE TABLE IF NOT EXISTS transcript (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id TEXT NOT NULL,
    ts TEXT NOT NULL,
    author_id TEXT NOT NULL,
    source TEXT NOT NULL,
    content TEXT NOT NULL
  );
CREATE TABLE IF NOT EXISTS user_activity (
        guild_id           TEXT NOT NULL,
        user_id            TEXT NOT NULL,
        joined_at          INTEGER NOT NULL,
        first_message_at   INTEGER,
        flagged_at         INTEGER, flagged_reason TEXT, manual_flag INTEGER DEFAULT 0, flagged_by TEXT, left_at INTEGER,
        PRIMARY KEY (guild_id, user_id)
      );
CREATE TABLE IF NOT EXISTS user_cache (
      user_id       TEXT NOT NULL,
      guild_id      TEXT NOT NULL,
      username      TEXT NOT NULL,
      global_name   TEXT,
      display_name  TEXT,
      avatar_hash   TEXT,
      avatar_url    TEXT NOT NULL,
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')), banner_url TEXT, accent_color INTEGER, joined_at INTEGER, created_at INTEGER,
      PRIMARY KEY (user_id, guild_id)
    );
CREATE TABLE IF NOT EXISTS user_message_counts (
          guild_id        TEXT NOT NULL,
          user_id         TEXT NOT NULL,
          message_count   INTEGER NOT NULL DEFAULT 0,
          last_milestone  INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (guild_id, user_id)
        );
CREATE TABLE IF NOT EXISTS user_names (
    id           TEXT PRIMARY KEY,
    username     TEXT,
    global_name  TEXT,
    nickname     TEXT,
    display      TEXT NOT NULL,
    in_guild     INTEGER NOT NULL,
    fetched_at_s INTEGER NOT NULL
  );
CREATE TABLE IF NOT EXISTS user_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  username TEXT,
  discriminator TEXT,
  global_name TEXT,
  avatar_url TEXT,
  joined_at TEXT,
  account_created_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS verified_users (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id          TEXT NOT NULL,
      discord_user_id   TEXT NOT NULL,
      category          TEXT NOT NULL,
      verified_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(guild_id, discord_user_id)
    );
CREATE TABLE IF NOT EXISTS verify_thread (
      guild_id    TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      thread_id   TEXT NOT NULL,
      state       TEXT NOT NULL DEFAULT 'created',
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      resolved_at INTEGER,
      PRIMARY KEY (guild_id, user_id)
    );
CREATE TABLE IF NOT EXISTS voice_session (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      joined_at_s INTEGER NOT NULL,
      left_at_s INTEGER,
      UNIQUE(guild_id, user_id, channel_id, joined_at_s)
    );
CREATE TABLE IF NOT EXISTS vote_out (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id TEXT NOT NULL,
    voter_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), reason TEXT,
    UNIQUE(app_id, voter_id)
  );
CREATE INDEX IF NOT EXISTS idx_ack_security_guild ON acknowledged_security_issues(guild_id);
CREATE INDEX IF NOT EXISTS idx_action_log_actor_action_time
    ON action_log(actor_id, action, created_at_s DESC);
CREATE INDEX IF NOT EXISTS idx_action_log_actor_guild_time
    ON action_log(actor_id, guild_id, created_at_s DESC);
CREATE INDEX IF NOT EXISTS idx_action_log_actor_time ON action_log(actor_id, created_at_s DESC);
CREATE INDEX IF NOT EXISTS idx_action_log_app ON action_log(app_id);
CREATE INDEX IF NOT EXISTS idx_action_log_app_action_time
    ON action_log(app_id, action, created_at_s);
CREATE INDEX IF NOT EXISTS idx_action_log_guild_action_created
     ON action_log(guild_id, action, created_at_s);
CREATE INDEX IF NOT EXISTS idx_action_log_guild_app
    ON action_log(guild_id, app_id, created_at_s DESC);
CREATE INDEX IF NOT EXISTS idx_action_log_guild_time ON action_log(guild_id, created_at_s DESC);
CREATE INDEX IF NOT EXISTS idx_active_byte_expires ON active_byte_multipliers(expires_at);
CREATE INDEX IF NOT EXISTS idx_active_byte_user ON active_byte_multipliers(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_active_movie_sessions_guild
      ON active_movie_sessions(guild_id, event_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_active_unique
ON application(guild_id, user_id)
WHERE status IN ('draft','submitted','needs_info');
CREATE INDEX IF NOT EXISTS idx_app_guild_status ON application(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_app_short_codes_guild_code ON app_short_codes(guild_id, code);
CREATE INDEX IF NOT EXISTS idx_app_short_codes_guild_id ON app_short_codes(guild_id);
CREATE INDEX IF NOT EXISTS idx_applicants_guild_user_permrej
        ON application(guild_id, user_id, permanently_rejected);
CREATE INDEX IF NOT EXISTS idx_application_applicant_time
      ON application(user_id, COALESCE(resolved_at, submitted_at, created_at));
CREATE INDEX IF NOT EXISTS idx_application_guild_created
    ON application(guild_id, created_at);
CREATE INDEX IF NOT EXISTS idx_application_guild_status ON application(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_application_guild_status_created
    ON application(guild_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_application_guild_user ON application(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_application_status_created
      ON application(status, created_at);
CREATE INDEX IF NOT EXISTS idx_application_user ON application(user_id);
CREATE INDEX IF NOT EXISTS idx_art_job_artist ON art_job(artist_id, status);
CREATE INDEX IF NOT EXISTS idx_art_job_artist_number ON art_job(guild_id, artist_id, artist_job_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_art_job_artist_number_unique
    ON art_job(guild_id, artist_id, artist_job_number);
CREATE INDEX IF NOT EXISTS idx_art_job_guild_status ON art_job(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_art_job_ticket ON art_job(ticket_id);
CREATE INDEX IF NOT EXISTS idx_artist_assignment_log_artist ON artist_assignment_log(artist_id);
CREATE INDEX IF NOT EXISTS idx_artist_assignment_log_guild ON artist_assignment_log(guild_id);
CREATE INDEX IF NOT EXISTS idx_artist_queue_guild_position ON artist_queue(guild_id, position);
CREATE INDEX IF NOT EXISTS idx_attach_ticket ON ticket_attachment(ticket_id);
CREATE INDEX IF NOT EXISTS idx_audit_findings_cmd ON audit_findings(command_name, subcommand);
CREATE INDEX IF NOT EXISTS idx_audit_findings_run ON audit_findings(audit_run_id);
CREATE INDEX IF NOT EXISTS idx_audit_findings_severity ON audit_findings(issue_severity);
CREATE INDEX IF NOT EXISTS idx_audit_findings_status ON audit_findings(test_status);
CREATE INDEX IF NOT EXISTS idx_audit_scanned_session ON audit_scanned_users(session_id);
CREATE INDEX IF NOT EXISTS idx_audit_sessions_active ON audit_sessions(guild_id, audit_type, status);
CREATE INDEX IF NOT EXISTS idx_avatar_scan_app ON avatar_scan(app_id);
CREATE INDEX IF NOT EXISTS idx_bfp_status ON backfill_progress(status);
CREATE INDEX IF NOT EXISTS idx_config_audit_guild
    ON config_audit_log(guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_db_backups_checksum ON db_backups(checksum);
CREATE INDEX IF NOT EXISTS idx_db_backups_created_at ON db_backups(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_ticket ON ticket_event(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_gme_time ON general_messages_effort(created_at_s);
CREATE INDEX IF NOT EXISTS idx_gme_time_id_score
    ON general_messages_effort(created_at_s, id, score);
CREATE INDEX IF NOT EXISTS idx_gmr_human_text_id
    ON general_messages_raw(id)
    WHERE is_bot = 0 AND length(content) > 0;
CREATE INDEX IF NOT EXISTS idx_gmr_human_time_author_id
    ON general_messages_raw(created_at_s, author_id, id)
    WHERE is_bot = 0;
CREATE INDEX IF NOT EXISTS idx_gmr_time ON general_messages_raw(created_at_s);
CREATE INDEX IF NOT EXISTS idx_gmres_id_score
    ON general_messages_resonance(id, score);
CREATE INDEX IF NOT EXISTS idx_gmres_time ON general_messages_resonance(created_at_s);
CREATE INDEX IF NOT EXISTS idx_gms_id_score
    ON general_messages_score(id, score);
CREATE INDEX IF NOT EXISTS idx_gms_time ON general_messages_score(created_at_s);
CREATE INDEX IF NOT EXISTS idx_health_alerts_severity ON health_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_health_alerts_triggered_at ON health_alerts(triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_alerts_type ON health_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_invite_guild_joined ON invite_usage(guild_id, joined_at_s);
CREATE INDEX IF NOT EXISTS idx_issue_history_guild ON security_issue_history(guild_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_level_reward_granted_guild_user ON level_reward_granted(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_level_rewards_guild ON level_rewards(guild_id, level);
CREATE INDEX IF NOT EXISTS idx_message_activity_guild_hour
        ON message_activity(guild_id, hour_bucket);
CREATE INDEX IF NOT EXISTS idx_message_activity_guild_time
        ON message_activity(guild_id, created_at_s DESC);
CREATE INDEX IF NOT EXISTS idx_message_activity_guild_time_user_channel
    ON message_activity(guild_id, created_at_s, user_id, channel_id);
CREATE INDEX IF NOT EXISTS idx_mod_metrics_guild_id
               ON mod_metrics(guild_id, total_accepts DESC);
CREATE INDEX IF NOT EXISTS idx_modmail_guild_status_user
    ON modmail_ticket(guild_id, status, user_id);
CREATE INDEX IF NOT EXISTS idx_modmail_guild_user ON modmail_bridge(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_modmail_message_ticket_id
    ON modmail_message(ticket_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_modmail_message_ticket_time
    ON modmail_message(ticket_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_modmail_open_unique
ON modmail_bridge(guild_id, user_id)
WHERE state = 'open';
CREATE INDEX IF NOT EXISTS idx_modmail_ticket_guild_status
    ON modmail_ticket(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_modmail_ticket_guild_user_status
    ON modmail_ticket(guild_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_movie_attendance_date ON movie_attendance(event_date);
CREATE INDEX IF NOT EXISTS idx_movie_attendance_event_type
      ON movie_attendance(guild_id, event_type, event_date);
CREATE INDEX IF NOT EXISTS idx_movie_attendance_guild_user ON movie_attendance(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_msg_ticket ON ticket_message(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_msgarc_author_time ON messages_archive(author_id, created_at_s);
CREATE INDEX IF NOT EXISTS idx_msgarc_channel_time ON messages_archive(channel_id, created_at_s);
CREATE INDEX IF NOT EXISTS idx_msgarc_guild_time ON messages_archive(guild_id, created_at_s);
CREATE INDEX IF NOT EXISTS idx_msr_user_recent
        ON member_role_snapshots(guild_id, user_id, removed_at DESC);
CREATE INDEX IF NOT EXISTS idx_nsfw_flags_guild ON nsfw_flags(guild_id);
CREATE INDEX IF NOT EXISTS idx_nsfw_flags_pending ON nsfw_flags(guild_id, reviewed);
CREATE INDEX IF NOT EXISTS idx_nsfw_flags_user
    ON nsfw_flags(user_id);
CREATE INDEX IF NOT EXISTS idx_open_modmail_thread
        ON open_modmail(thread_id);
CREATE INDEX IF NOT EXISTS idx_patreon_art_log_user
    ON patreon_art_log(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_qotd_suggestion_guild_code ON qotd_suggestion(guild_id, short_code);
CREATE INDEX IF NOT EXISTS idx_qotd_suggestion_guild_status ON qotd_suggestion(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_qotd_suggestion_guild_user ON qotd_suggestion(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_react_emoji ON message_reactions_archive(emoji);
CREATE INDEX IF NOT EXISTS idx_react_user ON message_reactions_archive(user_id);
CREATE INDEX IF NOT EXISTS idx_review_action_actor_time
      ON review_action(moderator_id, created_at);
CREATE INDEX IF NOT EXISTS idx_review_action_app
      ON review_action(app_id);
CREATE INDEX IF NOT EXISTS idx_review_action_app_time
      ON review_action(app_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_moderator
      ON review_action(moderator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_role_assignments_role ON role_assignments(role_id);
CREATE INDEX IF NOT EXISTS idx_role_assignments_time ON role_assignments(created_at);
CREATE INDEX IF NOT EXISTS idx_role_assignments_user ON role_assignments(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_role_cache_guild ON role_cache(guild_id);
CREATE INDEX IF NOT EXISTS idx_role_tiers_guild ON role_tiers(guild_id, tier_type);
CREATE INDEX IF NOT EXISTS idx_security_snapshots_guild ON security_audit_snapshots(guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshot_user ON user_snapshot(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_ticket_channel ON ticket(channel_id);
CREATE INDEX IF NOT EXISTS idx_ticket_claimer ON ticket(claimed_by_user_id);
CREATE INDEX IF NOT EXISTS idx_ticket_opener ON ticket(opener_user_id);
CREATE INDEX IF NOT EXISTS idx_ticket_status ON ticket(status);
CREATE INDEX IF NOT EXISTS idx_transcript_app_ts ON transcript(app_id, ts);
CREATE INDEX IF NOT EXISTS idx_ua_guild_joined ON user_activity(guild_id, joined_at);
CREATE INDEX IF NOT EXISTS idx_ua_guild_left ON user_activity(guild_id, left_at);
CREATE INDEX IF NOT EXISTS idx_user_activity_guild_flagged
      ON user_activity(guild_id, flagged_at)
      WHERE flagged_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_activity_guild_user
      ON user_activity(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_user_cache_guild_id
    ON user_cache(guild_id);
CREATE INDEX IF NOT EXISTS idx_user_cache_updated_at
    ON user_cache(updated_at);
CREATE INDEX IF NOT EXISTS idx_verify_thread_thread_id ON verify_thread(thread_id);
CREATE INDEX IF NOT EXISTS idx_vote_out_app ON vote_out(app_id);
CREATE INDEX IF NOT EXISTS idx_vs_guild_joined ON voice_session(guild_id, joined_at_s);
CREATE INDEX IF NOT EXISTS idx_vs_guild_user ON voice_session(guild_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_avatar_scan_application ON avatar_scan(application_id);
