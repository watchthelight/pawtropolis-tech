BEGIN;

-- Rebuild application table with new statuses and updated_at column
ALTER TABLE application RENAME TO application__old;

CREATE TABLE application (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  status   TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected','needs_info','kicked')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT,
  resolved_at  TEXT,
  resolver_id  TEXT,
  resolution_reason TEXT,
  FOREIGN KEY (guild_id) REFERENCES guild_config(guild_id) ON DELETE CASCADE
);

INSERT INTO application (
  id,
  guild_id,
  user_id,
  status,
  created_at,
  updated_at,
  submitted_at,
  resolved_at,
  resolver_id,
  resolution_reason
)
SELECT
  id,
  guild_id,
  user_id,
  CASE status
    WHEN 'accepted' THEN 'approved'
    ELSE status
  END,
  created_at,
  COALESCE(resolved_at, submitted_at, created_at),
  submitted_at,
  resolved_at,
  resolver_id,
  resolution_reason
FROM application__old;

DROP TABLE application__old;

-- Rebuild review_action table with meta column and new action values
ALTER TABLE review_action RENAME TO review_action__old;

CREATE TABLE review_action (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT,
  moderator_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approve','reject','kick','need_info')),
  reason TEXT,
  message_link TEXT,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (app_id) REFERENCES application(id) ON DELETE SET NULL
);

INSERT INTO review_action (
  id,
  app_id,
  moderator_id,
  action,
  reason,
  message_link,
  created_at
)
SELECT
  id,
  app_id,
  moderator_id,
  CASE action
    WHEN 'accept' THEN 'approve'
    WHEN 'modmail' THEN 'need_info'
    WHEN 'ping' THEN 'need_info'
    ELSE action
  END,
  reason,
  message_link,
  created_at
FROM review_action__old
WHERE action IN ('accept','reject','kick','modmail','ping');

DROP TABLE review_action__old;

-- Review card mapping table
CREATE TABLE IF NOT EXISTS review_card (
  app_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (app_id) REFERENCES application(id) ON DELETE CASCADE
);

-- Recreate indexes lost during rebuild
CREATE INDEX IF NOT EXISTS idx_app_guild_status ON application(guild_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_active_unique
ON application(guild_id, user_id)
WHERE status IN ('draft','submitted','needs_info');

CREATE INDEX IF NOT EXISTS idx_review_app ON review_action(app_id);

COMMIT;
