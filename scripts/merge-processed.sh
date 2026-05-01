#!/bin/bash
# Merge /tmp/processed-export.db into the live data.db on this host.
# Uses INSERT OR IGNORE for ctx/effort/resonance (preserves any rows the bot
# wrote since the snapshot) and INSERT OR REPLACE for overlay (full rebuild).

set -e

DB="${DB:-/home/ubuntu/pawtropolis-tech/data/data.db}"
SRC="${SRC:-/tmp/processed-export.db}"

if [ ! -f "$SRC" ]; then echo "missing $SRC"; exit 1; fi

echo "[merge] starting against $DB"
sqlite3 "$DB" <<EOF
ATTACH DATABASE '$SRC' AS s;
.timer on
INSERT OR IGNORE INTO general_messages_ctx       SELECT * FROM s.general_messages_ctx;
INSERT OR IGNORE INTO general_messages_effort    SELECT * FROM s.general_messages_effort;
INSERT OR IGNORE INTO general_messages_resonance SELECT * FROM s.general_messages_resonance;
CREATE TABLE IF NOT EXISTS general_messages_overlay_weekly AS SELECT * FROM s.general_messages_overlay_weekly WHERE 0;
INSERT OR REPLACE INTO general_messages_overlay_weekly SELECT * FROM s.general_messages_overlay_weekly;
DETACH DATABASE s;
SELECT 'ctx',       COUNT(*) FROM general_messages_ctx;
SELECT 'effort',    COUNT(*) FROM general_messages_effort;
SELECT 'resonance', COUNT(*) FROM general_messages_resonance;
SELECT 'overlay',   COUNT(*) FROM general_messages_overlay_weekly;
EOF
echo "[merge] done"
