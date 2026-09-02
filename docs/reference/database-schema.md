# Database Schema

Generated from `tests/fixtures/schema.sql` by `scripts/gen-schema-doc.mjs` (`npm run docs:schema`). Do not edit by hand; regenerate after a migration and commit both files.

SQLite in WAL mode at `DB_PATH` (default `data/data.db`). Discord ids are TEXT snowflakes. Timestamps are either ISO 8601 TEXT (`*_at`) or Unix seconds INTEGER (`*_at_s`, `*_ts`), as named. The bot opens the file with a 64 MB page cache, a 256 MB memory map and a 64 MB WAL cap; the dashboard opens the same file read-mostly.

101 tables, 0 virtual tables, 119 indexes.

## Retention

| Table | Removed automatically |
|---|---|
| `security_issue_history` | rows older than 90 days (retention scheduler, RETENTION_ENABLED=true) |
| `consumed_confirmations` | rows older than 1 day (retention scheduler) |
| `config_audit_log` | rows older than 365 days (retention scheduler) |
| `member_role_snapshots` | restored snapshots older than 180 days (retention scheduler) |
| `message_activity` | rows older than 90 days (messageActivityPrune scheduler, daily) |
| `action_log_fts` | external-content index over action_log, rebuilt hourly for new rows |

Everything else is kept. `messages_archive` (the full message backfill) is deliberately unbounded. Deploy backups in `data/backups` are pruned to the 3 newest plus 7 days by the same retention scheduler.

## Tables

### acknowledged_security_issues

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `guild_id` | TEXT | not null |
| `issue_key` | TEXT | not null |
| `severity` | TEXT | not null |
| `title` | TEXT | not null |
| `permission_hash` | TEXT | not null |
| `acknowledged_by` | TEXT | not null |
| `acknowledged_at` | INTEGER | not null |
| `reason` | TEXT |  |

Indexes: `idx_ack_security_guild`

### action_log

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `guild_id` | TEXT | not null |
| `app_id` | TEXT |  |
| `app_code` | TEXT |  |
| `actor_id` | TEXT | not null |
| `subject_id` | TEXT |  |
| `action` | TEXT | not null |
| `reason` | TEXT |  |
| `meta_json` | TEXT |  |
| `created_at_s` | INTEGER | not null |

Indexes: `idx_action_log_actor_action_time`, `idx_action_log_actor_guild_time`, `idx_action_log_actor_time`, `idx_action_log_app`, `idx_action_log_app_action_time`, `idx_action_log_guild_action_created`, `idx_action_log_guild_app`, `idx_action_log_guild_time`

### active_byte_multipliers

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `guild_id` | TEXT | not null |
| `user_id` | TEXT | not null |
| `multiplier_role_id` | TEXT | not null |
| `multiplier_name` | TEXT | not null |
| `multiplier_value` | INTEGER | not null |
| `expires_at` | INTEGER | not null |
| `token_rarity` | TEXT | not null |
| `redeemed_by` | TEXT | not null |
| `created_at` | INTEGER | not null |

Indexes: `idx_active_byte_expires`, `idx_active_byte_user`

### active_movie_events

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | pk |
| `channel_id` | TEXT | not null |
| `event_date` | TEXT | not null |
| `started_at` | INTEGER | not null |
| `created_at` | INTEGER |  |
| `event_type` | TEXT |  |

### active_movie_sessions

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | not null |
| `user_id` | TEXT | not null |
| `event_date` | TEXT | not null |
| `current_session_start` | INTEGER |  |
| `accumulated_minutes` | INTEGER |  |
| `longest_session_minutes` | INTEGER |  |
| `last_persisted_at` | INTEGER | not null |
| `event_type` | TEXT |  |

Indexes: `idx_active_movie_sessions_guild`

### activity_heatmap

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | not null |
| `dow` | INTEGER | not null |
| `hour` | INTEGER | not null |
| `msg_count` | INTEGER | not null |

### ai_detection_toggles

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | not null |
| `service` | TEXT | not null |
| `enabled` | INTEGER | not null |
| `updated_at` | TEXT | not null |

### app_short_codes

| Column | Type | Notes |
|---|---|---|
| `app_id` | TEXT | not null |
| `guild_id` | TEXT | not null |
| `code` | TEXT | not null |
| `created_at` | INTEGER | not null |
| `guild_id` | TEXT | not null |
| `user_id` | TEXT | not null |
| `status` | TEXT | not null |
| `created_at` | TEXT | not null |
| `updated_at` | TEXT | not null |
| `submitted_at` | TEXT |  |
| `resolved_at` | TEXT |  |
| `resolver_id` | TEXT |  |
| `resolution_reason` | TEXT |  |
| `perma_rejected` | INTEGER | not null |
| `permanently_rejected` | INTEGER | not null |
| `permanent_reject_at` | TEXT |  |
| `stale_alert_sent` | INTEGER | not null |
| `stale_alert_sent_at` | TEXT |  |

Indexes: `idx_app_short_codes_guild_code`, `idx_app_short_codes_guild_id`

### application_response

| Column | Type | Notes |
|---|---|---|
| `app_id` | TEXT | not null |
| `q_index` | INTEGER | not null |
| `question` | TEXT | not null |
| `answer` | TEXT | not null |
| `created_at` | TEXT | not null |

### art_job

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `guild_id` | TEXT | not null |
| `job_number` | INTEGER | not null |
| `artist_id` | TEXT | not null |
| `artist_job_number` | INTEGER | not null |
| `recipient_id` | TEXT | not null |
| `ticket_type` | TEXT | not null |
| `status` | TEXT | not null |
| `assigned_at` | TEXT |  |
| `updated_at` | TEXT |  |
| `completed_at` | TEXT |  |
| `notes` | TEXT |  |
| `assignment_log_id` | INTEGER |  |
| `ticket_id` | TEXT |  |
| `thumbnail_url` | TEXT |  |

Indexes: `idx_art_job_artist`, `idx_art_job_artist_number`, `idx_art_job_artist_number_unique`, `idx_art_job_guild_status`, `idx_art_job_ticket`

### artist_assignment_log

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `guild_id` | TEXT | not null |
| `artist_id` | TEXT | not null |
| `recipient_id` | TEXT | not null |
| `ticket_type` | TEXT | not null |
| `ticket_role_id` | TEXT |  |
| `assigned_by` | TEXT | not null |
| `assigned_at` | TEXT |  |
| `channel_id` | TEXT |  |
| `override` | INTEGER |  |

Indexes: `idx_artist_assignment_log_artist`, `idx_artist_assignment_log_guild`

### artist_queue

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `guild_id` | TEXT | not null |
| `user_id` | TEXT | not null |
| `position` | INTEGER | not null |
| `added_at` | TEXT |  |
| `assignments_count` | INTEGER |  |
| `last_assigned_at` | TEXT |  |
| `skipped` | INTEGER |  |
| `skip_reason` | TEXT |  |

Indexes: `idx_artist_queue_guild_position`

### audit_findings

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `audit_run_id` | TEXT | not null |
| `command_name` | TEXT | not null |
| `subcommand` | TEXT |  |
| `test_status` | TEXT | not null |
| `test_type` | TEXT | not null |
| `issue_severity` | TEXT |  |
| `issue_category` | TEXT |  |
| `issue_title` | TEXT |  |
| `issue_description` | TEXT |  |
| `response_time_ms` | INTEGER |  |
| `api_calls_made` | INTEGER | not null |
| `api_cost_estimate` | REAL | not null |
| `doc_file` | TEXT |  |
| `doc_accurate` | INTEGER |  |
| `doc_issue` | TEXT |  |
| `expected_permission` | TEXT |  |
| `actual_permission` | TEXT |  |
| `permission_match` | INTEGER |  |
| `notes` | TEXT |  |
| `created_at` | INTEGER | not null |

Indexes: `idx_audit_findings_cmd`, `idx_audit_findings_run`, `idx_audit_findings_severity`, `idx_audit_findings_status`

### audit_scanned_users

| Column | Type | Notes |
|---|---|---|
| `session_id` | INTEGER | not null |
| `user_id` | TEXT | not null |
| `scanned_at` | TEXT | not null |

Indexes: `idx_audit_scanned_session`

### audit_sessions

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `guild_id` | TEXT | not null |
| `audit_type` | TEXT | not null |
| `scope` | TEXT |  |
| `status` | TEXT | not null |
| `started_by` | TEXT | not null |
| `started_at` | TEXT | not null |
| `completed_at` | TEXT |  |
| `total_to_scan` | INTEGER | not null |
| `scanned_count` | INTEGER | not null |
| `flagged_count` | INTEGER | not null |
| `api_calls` | INTEGER | not null |
| `channel_id` | TEXT | not null |

Indexes: `idx_audit_sessions_active`

### avatar_scan

| Column | Type | Notes |
|---|---|---|
| `application_id` | TEXT | pk |
| `avatar_url` | TEXT | not null |
| `nsfw_score` | REAL |  |
| `skin_edge_score` | REAL |  |
| `flagged` | INTEGER | not null |
| `reason` | TEXT | not null |
| `scanned_at` | TEXT | not null |
| `final_pct` | INTEGER | not null |
| `app_id` | TEXT |  |
| `edge_score` | REAL |  |
| `furry_score` | REAL |  |
| `scalie_score` | REAL |  |
| `updated_at` | INTEGER |  |
| `evidence_hard` | TEXT |  |
| `evidence_soft` | TEXT |  |
| `evidence_safe` | TEXT |  |
| `banner_url` | TEXT |  |
| `banner_nsfw_score` | REAL |  |
| `banner_final_pct` | INTEGER |  |
| `banner_reason` | TEXT |  |
| `banner_evidence_hard` | TEXT |  |
| `banner_evidence_soft` | TEXT |  |
| `banner_evidence_safe` | TEXT |  |
| `avatar_ai_score` | REAL |  |
| `banner_ai_score` | REAL |  |

Indexes: `idx_avatar_scan_app`, `ux_avatar_scan_application`

### backfill_progress

| Column | Type | Notes |
|---|---|---|
| `channel_id` | TEXT | pk |
| `guild_id` | TEXT | not null |
| `channel_name` | TEXT | not null |
| `oldest_seen_id` | TEXT |  |
| `oldest_seen_ts` | INTEGER |  |
| `newest_seen_id` | TEXT |  |
| `newest_seen_ts` | INTEGER |  |
| `messages_fetched` | INTEGER | not null |
| `reactions_fetched` | INTEGER | not null |
| `status` | TEXT | not null |
| `last_error` | TEXT |  |
| `started_at_s` | INTEGER |  |
| `completed_at_s` | INTEGER |  |
| `updated_at_s` | INTEGER | not null |

Indexes: `idx_bfp_status`

### backfill_stats

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `started_at_s` | INTEGER |  |
| `last_heartbeat_s` | INTEGER |  |
| `current_channel_id` | TEXT |  |
| `current_channel_name` | TEXT |  |
| `messages_total` | INTEGER | not null |
| `reactions_total` | INTEGER | not null |
| `channels_total` | INTEGER | not null |
| `channels_completed` | INTEGER | not null |
| `msgs_per_sec` | REAL | not null |
| `eta_seconds` | INTEGER |  |
| `disk_used_bytes` | INTEGER |  |
| `disk_total_bytes` | INTEGER |  |
| `iops_read` | INTEGER |  |
| `iops_write` | INTEGER |  |
| `process_state` | TEXT | not null |

### bot_permission_requirements

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `bot_id` | TEXT | not null, unique |
| `bot_name` | TEXT | not null |
| `required_permissions` | TEXT | not null |
| `notes` | TEXT |  |
| `created_at` | INTEGER | not null |
| `updated_at` | INTEGER | not null |

### bot_status

| Column | Type | Notes |
|---|---|---|
| `scope_key` | TEXT | pk, not null |
| `activity_type` | INTEGER | not null |
| `activity_text` | TEXT | not null |
| `status` | TEXT | not null |
| `updated_at` | INTEGER | not null |
| `custom_status` | TEXT |  |

### channel_cache

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | not null |
| `channel_id` | TEXT | not null |
| `name` | TEXT | not null |
| `type` | INTEGER | not null |
| `parent_id` | TEXT |  |
| `updated_at_s` | INTEGER | not null |

### channel_daily

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | not null |
| `day` | TEXT | not null |
| `channel_id` | TEXT | not null |
| `channel_name` | TEXT |  |
| `msg_count` | INTEGER | not null |

### cohort_retention

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | not null |
| `cohort_week` | TEXT | not null |
| `week_offset` | INTEGER | not null |
| `cohort_size` | INTEGER | not null |
| `retained` | INTEGER | not null |

### config_audit_log

Retention: rows older than 365 days (retention scheduler).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `guild_id` | TEXT | not null |
| `user_id` | TEXT | not null |
| `field_key` | TEXT | not null |
| `old_value` | TEXT |  |
| `new_value` | TEXT |  |
| `source` | TEXT | not null |
| `created_at` | TEXT | not null |

Indexes: `idx_config_audit_guild`

### consumed_confirmations

Retention: rows older than 1 day (retention scheduler).

| Column | Type | Notes |
|---|---|---|
| `confirm_id` | TEXT | pk |
| `consumed_at_s` | INTEGER | not null |

### daily_metrics

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | not null |
| `day` | TEXT | not null |
| `member_count` | INTEGER |  |
| `member_count_delta` | INTEGER |  |
| `joins` | INTEGER | not null |
| `leaves` | INTEGER | not null |
| `cumulative_net` | INTEGER |  |
| `message_count` | INTEGER | not null |
| `message_count_prev7` | INTEGER |  |
| `active_authors` | INTEGER | not null |
| `active_authors_7d` | INTEGER |  |
| `voice_minutes` | INTEGER | not null |
| `dec_approve` | INTEGER | not null |
| `dec_reject` | INTEGER | not null |
| `dec_kick` | INTEGER | not null |
| `apps_submitted` | INTEGER | not null |
| `apps_approved` | INTEGER | not null |
| `refreshed_at_s` | INTEGER | not null |

### db_backups

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `path` | TEXT | not null, unique |
| `created_at` | INTEGER | not null |
| `size_bytes` | INTEGER | not null |
| `integrity_result` | TEXT |  |
| `row_count` | INTEGER |  |
| `checksum` | TEXT |  |
| `verified_at` | INTEGER |  |
| `notes` | TEXT |  |

Indexes: `idx_db_backups_checksum`, `idx_db_backups_created_at`

### event_daily

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | not null |
| `event_date` | TEXT | not null |
| `event_type` | TEXT | not null |
| `qualified_count` | INTEGER | not null |
| `total_count` | INTEGER | not null |

### general_messages_ctx

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | pk |
| `ctx_json` | TEXT | not null |

### general_messages_effort

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | pk |
| `created_at_s` | INTEGER | not null |
| `score` | REAL | not null |
| `model` | TEXT | not null |

Indexes: `idx_gme_time`, `idx_gme_time_id_score`

### general_messages_embed

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | pk |
| `target_vec` | BLOB | not null |
| `ctx_vec` | BLOB | not null |
| `embedded_at_s` | INTEGER | not null |

### general_messages_gold

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | pk |
| `stratum_len` | INTEGER | not null |
| `stratum_score` | INTEGER | not null |
| `selected_at_s` | INTEGER | not null |

### general_messages_label

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | pk |
| `density` | REAL | not null |
| `specificity` | REAL | not null |
| `sincerity` | REAL | not null |
| `relevance` | REAL | not null |
| `effort` | REAL | not null |
| `rationale` | TEXT | not null |
| `model` | TEXT | not null |
| `in_tokens` | INTEGER | not null |
| `out_tokens` | INTEGER | not null |
| `cached_in` | INTEGER | not null |
| `labeled_at_s` | INTEGER | not null |

### general_messages_raw

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | pk |
| `created_at_s` | INTEGER | not null |
| `author_id` | TEXT | not null |
| `is_bot` | INTEGER | not null |
| `content` | TEXT | not null |
| `attachments` | INTEGER | not null |
| `embeds` | INTEGER | not null |
| `reply_to` | TEXT |  |

Indexes: `idx_gmr_human_text_id`, `idx_gmr_human_time_author_id`, `idx_gmr_time`

### general_messages_resonance

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | pk |
| `created_at_s` | INTEGER | not null |
| `reply_count` | INTEGER | not null |
| `score` | REAL | not null |

Indexes: `idx_gmres_id_score`, `idx_gmres_time`

### general_messages_score

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | pk |
| `created_at_s` | INTEGER | not null |
| `score` | REAL | not null |
| `features` | TEXT | not null |

Indexes: `idx_gms_id_score`, `idx_gms_time`

### guild_config

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | pk |
| `review_channel_id` | TEXT |  |
| `gate_channel_id` | TEXT |  |
| `unverified_channel_id` | TEXT |  |
| `general_channel_id` | TEXT |  |
| `accepted_role_id` | TEXT |  |
| `reviewer_role_id` | TEXT |  |
| `image_search_url_template` | TEXT | not null |
| `reapply_cooldown_hours` | INTEGER | not null |
| `min_account_age_hours` | INTEGER | not null |
| `min_join_age_hours` | INTEGER | not null |
| `created_at` | TEXT | not null |
| `updated_at` | TEXT | not null |
| `avatar_scan_enabled` | INTEGER | not null |
| `avatar_scan_nsfw_threshold` | REAL | not null |
| `avatar_scan_skin_edge_threshold` | REAL | not null |
| `avatar_scan_weight_model` | REAL | not null |
| `avatar_scan_weight_edge` | REAL | not null |
| `welcome_template` | TEXT |  |
| `info_channel_id` | TEXT |  |
| `rules_channel_id` | TEXT |  |
| `welcome_ping_role_id` | TEXT |  |
| `mod_role_ids` | TEXT |  |
| `gatekeeper_role_id` | TEXT |  |
| `modmail_log_channel_id` | TEXT |  |
| `review_roles_mode` | TEXT | not null |
| `modmail_delete_on_close` | INTEGER |  |
| `logging_channel_id` | TEXT |  |
| `flags_channel_id` | TEXT |  |
| `silent_first_msg_days` | INTEGER |  |
| `dadmode_enabled` | INTEGER |  |
| `dadmode_odds` | INTEGER |  |
| `listopen_public_output` | INTEGER |  |
| `forum_channel_id` | TEXT |  |
| `notify_role_id` | TEXT |  |
| `notify_mode` | TEXT |  |
| `notification_channel_id` | TEXT |  |
| `notify_cooldown_seconds` | INTEGER |  |
| `notify_max_per_hour` | INTEGER |  |
| `ping_dev_on_app` | INTEGER | not null |
| `panic_mode` | INTEGER | not null |
| `panic_enabled_at` | INTEGER |  |
| `panic_enabled_by` | TEXT |  |
| `updated_at_s` | INTEGER |  |
| `suggestion_channel_id` | TEXT |  |
| `suggestion_cooldown` | INTEGER |  |
| `artist_role_id` | TEXT |  |
| `ambassador_role_id` | TEXT |  |
| `server_artist_channel_id` | TEXT |  |
| `artist_ticket_roles_json` | TEXT |  |
| `support_channel_id` | TEXT |  |
| `artist_ignored_users_json` | TEXT |  |
| `backfill_notification_channel_id` | TEXT |  |
| `bot_dev_role_id` | TEXT |  |
| `gate_answer_max_length` | INTEGER |  |
| `banner_sync_interval_minutes` | INTEGER |  |
| `modmail_forward_max_size` | INTEGER |  |
| `retry_max_attempts` | INTEGER |  |
| `retry_initial_delay_ms` | INTEGER |  |
| `retry_max_delay_ms` | INTEGER |  |
| `circuit_breaker_threshold` | INTEGER |  |
| `circuit_breaker_reset_ms` | INTEGER |  |
| `avatar_scan_hard_threshold` | REAL |  |
| `avatar_scan_soft_threshold` | REAL |  |
| `avatar_scan_racy_threshold` | REAL |  |
| `flag_rate_limit_ms` | INTEGER |  |
| `flag_cooldown_ttl_ms` | INTEGER |  |
| `banner_sync_enabled` | INTEGER |  |
| `skullmode_enabled` | INTEGER |  |
| `skullmode_odds` | INTEGER |  |
| `report_forum_id` | TEXT |  |
| `nsfw_alert_role_id` | TEXT |  |
| `qotd_review_channel_id` | TEXT |  |
| `qotd_role_id` | TEXT |  |
| `pulse_excluded_category_ids_json` | TEXT |  |
| `vote_out_threshold` | INTEGER |  |
| `admin_role_id` | TEXT |  |
| `verify_thread_parent_id` | TEXT |  |
| `unverified_rules_channel_id` | TEXT |  |
| `level_reward_dm_enabled` | INTEGER |  |
| `inventory_enabled` | TEXT |  |
| `inventory_grace_seconds` | INTEGER |  |
| `inventory_debounce_seconds` | INTEGER |  |
| `inventory_source_bot_ids_json` | TEXT |  |
| `inventory_extra_roles_json` | TEXT |  |

### guild_game_config

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | pk |
| `qualification_percentage` | INTEGER |  |
| `attendance_mode` | TEXT |  |
| `updated_at` | INTEGER |  |

### guild_movie_config

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | pk |
| `attendance_mode` | TEXT |  |
| `updated_at` | INTEGER |  |
| `qualification_threshold_minutes` | INTEGER |  |

### guild_question

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | not null |
| `q_index` | INTEGER | not null |
| `prompt` | TEXT | not null |
| `required` | INTEGER | not null |

### guild_snapshot

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | pk |
| `member_count` | INTEGER | not null |
| `online_count` | INTEGER |  |
| `boost_count` | INTEGER |  |
| `boost_tier` | INTEGER |  |
| `channel_count` | INTEGER |  |
| `role_count` | INTEGER |  |
| `voice_users_now` | INTEGER |  |
| `updated_at_s` | INTEGER | not null |

### guild_snapshot_log

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | not null |
| `date` | TEXT | not null |
| `member_count` | INTEGER |  |
| `online_count` | INTEGER |  |
| `boost_count` | INTEGER |  |
| `boost_tier` | INTEGER |  |
| `voice_users_now` | INTEGER |  |

### health_alerts

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `alert_type` | TEXT | not null |
| `severity` | TEXT | not null |
| `triggered_at` | INTEGER | not null |
| `last_seen_at` | INTEGER | not null |
| `acknowledged_by` | TEXT |  |
| `acknowledged_at` | INTEGER |  |
| `resolved_by` | TEXT |  |
| `resolved_at` | INTEGER |  |
| `meta` | TEXT |  |

Indexes: `idx_health_alerts_severity`, `idx_health_alerts_triggered_at`, `idx_health_alerts_type`

### inventory_grant_keys

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | not null |
| `user_id` | TEXT | not null |
| `grant_key` | TEXT | not null |
| `created_at_s` | INTEGER | not null |

### inventory_items

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | not null |
| `user_id` | TEXT | not null |
| `item_key` | TEXT | not null |
| `quantity` | INTEGER | not null |
| `updated_at_s` | INTEGER | not null |

### inventory_log

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `guild_id` | TEXT | not null |
| `user_id` | TEXT | not null |
| `item_key` | TEXT | not null |
| `delta` | INTEGER | not null |
| `source` | TEXT | not null |
| `actor_id` | TEXT |  |
| `reason` | TEXT |  |
| `created_at_s` | INTEGER | not null |

Indexes: `idx_inventory_log_user`

### invite_label

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | not null |
| `invite_code` | TEXT | not null |
| `label` | TEXT | not null |

### invite_snapshot

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | not null |
| `invite_code` | TEXT | not null |
| `uses` | INTEGER | not null |
| `inviter_id` | TEXT |  |
| `updated_at_s` | INTEGER | not null |

### invite_usage

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | not null |
| `user_id` | TEXT | not null |
| `invite_code` | TEXT |  |
| `inviter_id` | TEXT |  |
| `joined_at_s` | INTEGER | not null |

Indexes: `idx_invite_guild_joined`

### level_reward_granted

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | not null |
| `user_id` | TEXT | not null |
| `level` | INTEGER | not null |
| `granted_at_s` | INTEGER | not null |

Indexes: `idx_level_reward_granted_guild_user`

### level_rewards

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `guild_id` | TEXT | not null |
| `level` | INTEGER | not null |
| `role_id` | TEXT | not null |
| `role_name` | TEXT | not null |
| `created_at` | INTEGER |  |

Indexes: `idx_level_rewards_guild`

### lost_and_found

| Column | Type | Notes |
|---|---|---|
| `rootpgno` | INTEGER |  |
| `pgno` | INTEGER |  |
| `nfield` | INTEGER |  |
| `id` | INTEGER |  |
| `c0` |   |  |
| `c1` |   |  |
| `c2` |   |  |
| `c3` |   |  |
| `c4` |   |  |
| `c5` |   |  |
| `c6` |   |  |
| `c7` |   |  |

### member_role_snapshots

Retention: restored snapshots older than 180 days (retention scheduler).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `guild_id` | TEXT | not null |
| `user_id` | TEXT | not null |
| `role_ids` | TEXT | not null |
| `removal_type` | TEXT | not null |
| `reason` | TEXT |  |
| `executor_id` | TEXT |  |
| `removed_at` | INTEGER | not null |
| `restored_at` | INTEGER |  |
| `restored_by` | TEXT |  |

Indexes: `idx_msr_user_recent`

### message_activity

Retention: rows older than 90 days (messageActivityPrune scheduler, daily).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `guild_id` | TEXT | not null |
| `channel_id` | TEXT | not null |
| `user_id` | TEXT | not null |
| `created_at_s` | INTEGER | not null |
| `hour_bucket` | INTEGER | not null |

Indexes: `idx_message_activity_guild_hour`, `idx_message_activity_guild_time`, `idx_message_activity_guild_time_user_channel`

### message_reactions_archive

| Column | Type | Notes |
|---|---|---|
| `message_id` | TEXT | not null |
| `emoji` | TEXT | not null |
| `user_id` | TEXT | not null |
| `reacted_at_s` | INTEGER |  |
| `ingest_source` | TEXT | not null |

Indexes: `idx_react_emoji`, `idx_react_user`

### messages_archive

| Column | Type | Notes |
|---|---|---|
| `message_id` | TEXT | pk |
| `guild_id` | TEXT | not null |
| `channel_id` | TEXT | not null |
| `thread_id` | TEXT |  |
| `author_id` | TEXT | not null |
| `author_name` | TEXT | not null |
| `author_is_bot` | INTEGER | not null |
| `content` | TEXT | not null |
| `attachments_json` | TEXT |  |
| `embeds_json` | TEXT |  |
| `reply_to_id` | TEXT |  |
| `is_edited` | INTEGER | not null |
| `is_deleted` | INTEGER | not null |
| `created_at_s` | INTEGER | not null |
| `edited_at_s` | INTEGER |  |
| `deleted_at_s` | INTEGER |  |
| `ingested_at_s` | INTEGER | not null |
| `ingest_source` | TEXT | not null |

Indexes: `idx_msgarc_author_time`, `idx_msgarc_channel_time`, `idx_msgarc_guild_time`

### metrics_epoch

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | pk |
| `start_at` | TEXT | not null |

### mod_leaderboard

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | not null |
| `moderator_id` | TEXT | not null |
| `display_label` | TEXT |  |
| `accepts` | INTEGER | not null |
| `rejects` | INTEGER | not null |
| `kicks` | INTEGER | not null |
| `p50_s` | REAL |  |
| `p95_s` | REAL |  |
| `sort_order` | INTEGER | not null |

### mod_metrics

| Column | Type | Notes |
|---|---|---|
| `moderator_id` | TEXT | not null |
| `guild_id` | TEXT | not null |
| `total_claims` | INTEGER | not null |
| `total_accepts` | INTEGER | not null |
| `total_rejects` | INTEGER | not null |
| `total_kicks` | INTEGER | not null |
| `total_modmail_opens` | INTEGER | not null |
| `avg_response_time_s` | REAL |  |
| `p50_response_time_s` | REAL |  |
| `p95_response_time_s` | REAL |  |
| `updated_at` | TEXT | not null |

Indexes: `idx_mod_metrics_guild_id`

### modmail_bridge

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `guild_id` | TEXT | not null |
| `user_id` | TEXT | not null |
| `thread_id` | TEXT | not null |
| `state` | TEXT | not null |
| `created_at` | TEXT | not null |
| `closed_at` | TEXT |  |

Indexes: `idx_modmail_guild_user`, `idx_modmail_open_unique`

### modmail_message

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `ticket_id` | INTEGER | not null |
| `direction` | TEXT | not null |
| `thread_message_id` | TEXT |  |
| `dm_message_id` | TEXT |  |
| `reply_to_thread_message_id` | TEXT |  |
| `reply_to_dm_message_id` | TEXT |  |
| `created_at` | TEXT | not null |
| `content` | TEXT |  |

Indexes: `idx_modmail_message_ticket_id`, `idx_modmail_message_ticket_time`

### modmail_ticket

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `guild_id` | TEXT | not null |
| `user_id` | TEXT | not null |
| `app_code` | TEXT |  |
| `review_message_id` | TEXT |  |
| `thread_id` | TEXT |  |
| `status` | TEXT | not null |
| `created_at` | TEXT | not null |
| `closed_at` | TEXT |  |
| `log_message_id` | TEXT |  |
| `log_channel_id` | TEXT |  |
| `thread_channel_id` | TEXT |  |
| `bot_migration_notified_at` | TEXT |  |

Indexes: `idx_modmail_guild_status_user`, `idx_modmail_ticket_guild_status`, `idx_modmail_ticket_guild_user_status`

### movie_attendance

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `guild_id` | TEXT | not null |
| `user_id` | TEXT | not null |
| `event_date` | TEXT | not null |
| `voice_channel_id` | TEXT | not null |
| `duration_minutes` | INTEGER | not null |
| `longest_session_minutes` | INTEGER | not null |
| `qualified` | INTEGER |  |
| `created_at` | INTEGER |  |
| `adjustment_type` | TEXT |  |
| `adjusted_by` | TEXT |  |
| `adjustment_reason` | TEXT |  |
| `event_type` | TEXT |  |
| `event_start_time` | INTEGER |  |
| `event_end_time` | INTEGER |  |

Indexes: `idx_movie_attendance_date`, `idx_movie_attendance_event_type`, `idx_movie_attendance_guild_user`

### nsfw_flags

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `guild_id` | TEXT | not null |
| `user_id` | TEXT | not null |
| `avatar_url` | TEXT | not null |
| `nsfw_score` | REAL | not null |
| `reason` | TEXT | not null |
| `flagged_by` | TEXT | not null |
| `flagged_at` | TEXT | not null |
| `reviewed` | INTEGER | not null |
| `reviewed_by` | TEXT |  |
| `reviewed_at` | TEXT |  |

Indexes: `idx_nsfw_flags_guild`, `idx_nsfw_flags_pending`, `idx_nsfw_flags_user`

### open_modmail

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | not null |
| `applicant_id` | TEXT | not null |
| `thread_id` | TEXT | not null |
| `created_at` | INTEGER | not null |

Indexes: `idx_open_modmail_thread`

### patreon_art_granted

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | not null |
| `user_id` | TEXT | not null |
| `art_type` | TEXT | not null |
| `quantity_granted` | INTEGER | not null |
| `quantity_redeemed` | INTEGER | not null |
| `last_granted_at_s` | INTEGER |  |

### patreon_art_log

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `guild_id` | TEXT | not null |
| `user_id` | TEXT | not null |
| `art_type` | TEXT | not null |
| `quantity` | INTEGER | not null |
| `patreon_tier` | TEXT | not null |
| `reason` | TEXT |  |
| `created_at_s` | INTEGER | not null |

Indexes: `idx_patreon_art_log_user`

### pending_item_capture

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `guild_id` | TEXT | not null |
| `user_id` | TEXT | not null |
| `role_id` | TEXT | not null |
| `item_key` | TEXT | not null |
| `grant_key` | TEXT |  |
| `detected_at_s` | INTEGER | not null |
| `remove_at_s` | INTEGER | not null |
| `attempts` | INTEGER | not null |

Indexes: `idx_pending_item_capture_due`

### qotd_suggestion

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `guild_id` | TEXT | not null |
| `user_id` | TEXT | not null |
| `question` | TEXT | not null |
| `status` | TEXT | not null |
| `short_code` | TEXT | not null |
| `review_message_id` | TEXT |  |
| `reviewed_by` | TEXT |  |
| `reviewed_at_s` | INTEGER |  |
| `reject_reason` | TEXT |  |
| `used_by` | TEXT |  |
| `used_at_s` | INTEGER |  |
| `created_at_s` | INTEGER | not null |

Indexes: `idx_qotd_suggestion_guild_code`, `idx_qotd_suggestion_guild_status`, `idx_qotd_suggestion_guild_user`

### qotd_weekly

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | not null |
| `week` | TEXT | not null |
| `submitted` | INTEGER | not null |
| `approved` | INTEGER | not null |
| `used` | INTEGER | not null |

### reaction_emoji

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | not null |
| `emoji` | TEXT | not null |
| `count` | INTEGER | not null |

### review_action

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `app_id` | TEXT | not null |
| `moderator_id` | TEXT | not null |
| `action` | TEXT | not null |
| `reason` | TEXT |  |
| `message_link` | TEXT |  |
| `meta` | TEXT |  |
| `created_at` | INTEGER | not null |

Indexes: `idx_review_action_actor_time`, `idx_review_action_app`, `idx_review_action_app_time`, `idx_review_moderator`

### review_card

| Column | Type | Notes |
|---|---|---|
| `app_id` | TEXT | pk |
| `channel_id` | TEXT | not null |
| `message_id` | TEXT | not null |
| `updated_at` | TEXT | not null |

### review_claim

| Column | Type | Notes |
|---|---|---|
| `app_id` | TEXT | pk |
| `reviewer_id` | TEXT | not null |
| `claimed_at` | TEXT | not null |

### role_assignments

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `guild_id` | TEXT | not null |
| `user_id` | TEXT | not null |
| `role_id` | TEXT | not null |
| `role_name` | TEXT |  |
| `action` | TEXT | not null |
| `reason` | TEXT |  |
| `triggered_by` | TEXT |  |
| `details` | TEXT |  |
| `created_at` | INTEGER |  |

Indexes: `idx_role_assignments_role`, `idx_role_assignments_time`, `idx_role_assignments_user`

### role_cache

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | not null |
| `role_id` | TEXT | not null |
| `name` | TEXT | not null |
| `color` | INTEGER | not null |
| `position` | INTEGER | not null |
| `mentionable` | INTEGER | not null |
| `managed` | INTEGER | not null |
| `updated_at_s` | INTEGER | not null |

Indexes: `idx_role_cache_guild`

### role_tiers

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `guild_id` | TEXT | not null |
| `tier_type` | TEXT | not null |
| `tier_name` | TEXT | not null |
| `role_id` | TEXT | not null |
| `threshold` | INTEGER | not null |
| `created_at` | INTEGER |  |

Indexes: `idx_role_tiers_guild`

### rollup_meta

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | pk |
| `refreshed_at_s` | INTEGER | not null |

### schema_migrations

| Column | Type | Notes |
|---|---|---|
| `version` | TEXT | pk |
| `name` | TEXT | not null |
| `applied_at` | INTEGER | not null |

### security_audit_snapshots

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `guild_id` | TEXT | not null |
| `created_at` | INTEGER | not null |
| `role_count` | INTEGER | not null |
| `channel_count` | INTEGER | not null |
| `issue_count` | INTEGER | not null |
| `critical_count` | INTEGER | not null |
| `high_count` | INTEGER | not null |
| `medium_count` | INTEGER | not null |
| `low_count` | INTEGER | not null |
| `roles_snapshot` | TEXT | not null |
| `channels_snapshot` | TEXT | not null |
| `issues_snapshot` | TEXT | not null |
| `content_hash` | TEXT | not null |

Indexes: `idx_security_snapshots_guild`

### security_issue_history

Retention: rows older than 90 days (retention scheduler, RETENTION_ENABLED=true).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `guild_id` | TEXT | not null |
| `recorded_at` | INTEGER | not null |
| `critical_count` | INTEGER | not null |
| `high_count` | INTEGER | not null |
| `medium_count` | INTEGER | not null |
| `low_count` | INTEGER | not null |
| `acknowledged_count` | INTEGER | not null |
| `role_issues` | INTEGER | not null |
| `channel_issues` | INTEGER | not null |
| `hierarchy_issues` | INTEGER | not null |
| `verification_issues` | INTEGER | not null |

Indexes: `idx_issue_history_guild`

### sync_marker

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `last_modified_at` | INTEGER | not null |
| `last_modified_by` | TEXT | not null |
| `action_count` | INTEGER | not null |
| `last_action_type` | TEXT |  |
| `updated_at` | TEXT |  |

### tenure_buckets

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | not null |
| `bucket` | TEXT | not null |
| `member_count` | INTEGER | not null |
| `sort_order` | INTEGER | not null |

### testidea_state

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | pk |
| `enabled` | INTEGER | not null |
| `snapshot` | TEXT |  |
| `updated_at` | INTEGER | not null |
| `action_id` | TEXT |  |

### ticket

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | pk |
| `type_key` | TEXT | not null |
| `number` | INTEGER | not null |
| `channel_id` | TEXT | not null, unique |
| `staff_thread_id` | TEXT |  |
| `guild_id` | TEXT | not null |
| `opener_user_id` | TEXT | not null |
| `claimed_by_user_id` | TEXT |  |
| `status` | TEXT | not null |
| `close_reason` | TEXT |  |
| `closed_by_user_id` | TEXT |  |
| `archive_path` | TEXT |  |
| `legacy_source` | TEXT |  |
| `opened_at` | INTEGER | not null |
| `claimed_at` | INTEGER |  |
| `closed_at` | INTEGER |  |
| `greeting_message_id` | TEXT |  |

Indexes: `idx_ticket_channel`, `idx_ticket_claimer`, `idx_ticket_opener`, `idx_ticket_status`

### ticket_attachment

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | pk |
| `message_id` | TEXT | not null |
| `ticket_id` | TEXT | not null |
| `filename` | TEXT | not null |
| `mime` | TEXT |  |
| `size_bytes` | INTEGER | not null |
| `local_path` | TEXT |  |
| `sha256` | TEXT |  |
| `original_url` | TEXT | not null |
| `created_at` | INTEGER | not null |

Indexes: `idx_attach_ticket`

### ticket_counter

| Column | Type | Notes |
|---|---|---|
| `key` | TEXT | pk |
| `current_value` | INTEGER | not null |
| `updated_at` | INTEGER | not null |

### ticket_event

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `ticket_id` | TEXT | not null |
| `event_type` | TEXT | not null |
| `actor_user_id` | TEXT |  |
| `payload_json` | TEXT |  |
| `created_at` | INTEGER | not null |

Indexes: `idx_event_ticket`

### ticket_message

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | pk |
| `ticket_id` | TEXT | not null |
| `in_thread` | INTEGER | not null |
| `author_user_id` | TEXT | not null |
| `author_is_bot` | INTEGER | not null |
| `content` | TEXT |  |
| `embeds_json` | TEXT |  |
| `reply_to_message_id` | TEXT |  |
| `created_at` | INTEGER | not null |
| `edited_at` | INTEGER |  |
| `deleted_at` | INTEGER |  |

Indexes: `idx_msg_ticket`

### ticket_seq

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |

### ticket_type

| Column | Type | Notes |
|---|---|---|
| `key` | TEXT | pk |
| `label` | TEXT | not null |
| `panel_stack` | TEXT | not null |
| `panel_position` | INTEGER | not null |
| `button_emoji` | TEXT |  |
| `button_style` | INTEGER | not null |
| `embed_color` | INTEGER | not null |
| `num_counter_key` | TEXT | not null |
| `channel_name_template` | TEXT | not null |
| `greeting_md` | TEXT | not null |
| `ping_role_ids` | TEXT | not null |
| `perm_template_json` | TEXT | not null |
| `has_staff_thread` | INTEGER | not null |
| `is_active` | INTEGER | not null |
| `created_at` | INTEGER | not null |
| `updated_at` | INTEGER | not null |

### transcript

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `app_id` | TEXT | not null |
| `ts` | TEXT | not null |
| `author_id` | TEXT | not null |
| `source` | TEXT | not null |
| `content` | TEXT | not null |

Indexes: `idx_transcript_app_ts`

### user_activity

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | not null |
| `user_id` | TEXT | not null |
| `joined_at` | INTEGER | not null |
| `first_message_at` | INTEGER |  |
| `flagged_at` | INTEGER |  |
| `flagged_reason` | TEXT |  |
| `manual_flag` | INTEGER |  |
| `flagged_by` | TEXT |  |
| `left_at` | INTEGER |  |

Indexes: `idx_ua_guild_joined`, `idx_ua_guild_left`, `idx_user_activity_guild_flagged`, `idx_user_activity_guild_user`

### user_cache

| Column | Type | Notes |
|---|---|---|
| `user_id` | TEXT | not null |
| `guild_id` | TEXT | not null |
| `username` | TEXT | not null |
| `global_name` | TEXT |  |
| `display_name` | TEXT |  |
| `avatar_hash` | TEXT |  |
| `avatar_url` | TEXT | not null |
| `updated_at` | TEXT | not null |
| `banner_url` | TEXT |  |
| `accent_color` | INTEGER |  |
| `joined_at` | INTEGER |  |
| `created_at` | INTEGER |  |

Indexes: `idx_user_cache_guild_id`, `idx_user_cache_updated_at`

### user_message_counts

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | not null |
| `user_id` | TEXT | not null |
| `message_count` | INTEGER | not null |
| `last_milestone` | INTEGER | not null |

### user_names

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | pk |
| `username` | TEXT |  |
| `global_name` | TEXT |  |
| `nickname` | TEXT |  |
| `display` | TEXT | not null |
| `in_guild` | INTEGER | not null |
| `fetched_at_s` | INTEGER | not null |

### user_snapshot

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `guild_id` | TEXT | not null |
| `user_id` | TEXT | not null |
| `username` | TEXT |  |
| `discriminator` | TEXT |  |
| `global_name` | TEXT |  |
| `avatar_url` | TEXT |  |
| `joined_at` | TEXT |  |
| `account_created_at` | TEXT |  |
| `created_at` | TEXT | not null |

Indexes: `idx_snapshot_user`

### verified_users

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `guild_id` | TEXT | not null |
| `discord_user_id` | TEXT | not null |
| `category` | TEXT | not null |
| `verified_at` | INTEGER | not null |

### verify_thread

| Column | Type | Notes |
|---|---|---|
| `guild_id` | TEXT | not null |
| `user_id` | TEXT | not null |
| `thread_id` | TEXT | not null |
| `state` | TEXT | not null |
| `created_at` | INTEGER | not null |
| `resolved_at` | INTEGER |  |

Indexes: `idx_verify_thread_thread_id`

### voice_session

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `guild_id` | TEXT | not null |
| `user_id` | TEXT | not null |
| `channel_id` | TEXT | not null |
| `joined_at_s` | INTEGER | not null |
| `left_at_s` | INTEGER |  |

Indexes: `idx_vs_guild_joined`, `idx_vs_guild_user`

### vote_out

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER | pk |
| `app_id` | TEXT | not null |
| `voter_id` | TEXT | not null |
| `created_at` | TEXT | not null |
| `reason` | TEXT |  |

Indexes: `idx_vote_out_app`
