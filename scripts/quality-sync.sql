-- scripts/quality-sync.sql (RUN ON EC2)
--
-- Merges a previously-snapshotted quality DB into the live data.db.
-- Assumes:
--   - migration 069 has already created the destination tables in data/data.db
--   - data/quality-snapshot.db exists alongside data.db
--
-- Usage:
--   sqlite3 data/data.db < scripts/quality-sync.sql
--
-- The sync uses INSERT OR IGNORE on the message-id PKs so a partial earlier
-- run is safe to re-run, and going-forward live capture writes can't be
-- clobbered by a later snapshot import.

BEGIN;

ATTACH DATABASE 'data/quality-snapshot.db' AS q;

INSERT OR IGNORE INTO general_messages_raw       SELECT * FROM q.general_messages_raw;
INSERT OR IGNORE INTO general_messages_ctx       SELECT * FROM q.general_messages_ctx;
INSERT OR IGNORE INTO general_messages_embed     SELECT * FROM q.general_messages_embed;
INSERT OR IGNORE INTO general_messages_effort    SELECT * FROM q.general_messages_effort;
INSERT OR IGNORE INTO general_messages_resonance SELECT * FROM q.general_messages_resonance;
INSERT OR IGNORE INTO general_messages_score     SELECT * FROM q.general_messages_score;
INSERT OR IGNORE INTO general_messages_label     SELECT * FROM q.general_messages_label;
INSERT OR IGNORE INTO general_messages_gold      SELECT * FROM q.general_messages_gold;
INSERT OR IGNORE INTO user_names                 SELECT * FROM q.user_names;

DETACH DATABASE q;

COMMIT;

-- Verify after running:
SELECT 'raw'       AS t, COUNT(*) FROM general_messages_raw UNION ALL
SELECT 'ctx',          COUNT(*) FROM general_messages_ctx UNION ALL
SELECT 'embed',        COUNT(*) FROM general_messages_embed UNION ALL
SELECT 'effort',       COUNT(*) FROM general_messages_effort UNION ALL
SELECT 'resonance',    COUNT(*) FROM general_messages_resonance UNION ALL
SELECT 'score',        COUNT(*) FROM general_messages_score UNION ALL
SELECT 'label',        COUNT(*) FROM general_messages_label UNION ALL
SELECT 'gold',         COUNT(*) FROM general_messages_gold UNION ALL
SELECT 'user_names',   COUNT(*) FROM user_names;
