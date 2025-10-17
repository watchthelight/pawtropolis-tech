BEGIN;

ALTER TABLE guild_config ADD COLUMN avatar_scan_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE guild_config ADD COLUMN avatar_scan_nsfw_threshold REAL NOT NULL DEFAULT 0.60;
ALTER TABLE guild_config ADD COLUMN avatar_scan_skin_edge_threshold REAL NOT NULL DEFAULT 0.18;

CREATE TABLE IF NOT EXISTS avatar_scan (
  application_id TEXT PRIMARY KEY,
  avatar_url TEXT NOT NULL,
  nsfw_score REAL,
  skin_edge_score REAL,
  flagged INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT 'none',
  scanned_at TEXT NOT NULL
);

ALTER TABLE review_action RENAME TO review_action__old;

CREATE TABLE review_action (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id TEXT,
  moderator_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approve','reject','need_info','kick','avatar_viewsrc')),
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
  meta,
  created_at
)
SELECT
  id,
  app_id,
  moderator_id,
  CASE action
    WHEN 'approve' THEN 'approve'
    WHEN 'reject' THEN 'reject'
    WHEN 'need_info' THEN 'need_info'
    WHEN 'kick' THEN 'kick'
    WHEN 'avatar_viewsrc' THEN 'avatar_viewsrc'
    ELSE 'need_info'
  END,
  reason,
  message_link,
  meta,
  created_at
FROM review_action__old;

DROP TABLE review_action__old;

CREATE INDEX IF NOT EXISTS idx_review_app ON review_action(app_id);

COMMIT;
