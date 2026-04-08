#!/usr/bin/env bash
# Litestream restore drill for Pawtropolis Tech
#
# Pulls the latest snapshot of data/data.db from Cloudflare R2 to a temporary
# path, runs the integrity checker against it, and reports whether the chain
# is recoverable. Does NOT touch the live database — the live bot keeps
# running while this script runs.
#
# Run periodically (recommend monthly via cron) to catch silent corruption
# in the R2 backups BEFORE you actually need them. Restore drills that
# nobody runs are the ones that fail when production is on fire.
#
# Usage (on bash-ec2):
#   sudo /home/ubuntu/pawtropolis-tech/scripts/litestream-restore.sh
#   # or to a custom path:
#   sudo RESTORE_DEST=/tmp/foo.db /home/ubuntu/pawtropolis-tech/scripts/litestream-restore.sh
#
# Plan reference: Phase 1.3 of ~/.claude/plans/logical-squishing-dragon.md

set -euo pipefail

DEST="${RESTORE_DEST:-/tmp/pawtropolis-restore-test.db}"
LIVE_DB="/home/ubuntu/pawtropolis-tech/data/data.db"
INTEGRITY_SCRIPT="/home/ubuntu/pawtropolis-tech/scripts/verify-db-integrity.js"
LITESTREAM_CONFIG="/etc/litestream.yml"

echo "================================================================"
echo " Litestream restore drill"
echo "================================================================"
echo " Destination     : $DEST"
echo " Live DB (safe!) : $LIVE_DB"
echo " Config          : $LITESTREAM_CONFIG"
echo "================================================================"
echo

# Sanity: live DB must exist and we must NOT be writing to it.
if [ ! -f "$LIVE_DB" ]; then
  echo "ERROR: live DB not found at $LIVE_DB" >&2
  exit 1
fi
if [ "$DEST" = "$LIVE_DB" ]; then
  echo "ERROR: refusing to restore on top of the live DB" >&2
  exit 2
fi

# Clean up previous test artifacts so each drill starts fresh.
rm -f "$DEST" "${DEST}-shm" "${DEST}-wal" 2>/dev/null || true

echo "[1/4] Restoring latest snapshot from R2..."
litestream restore -config "$LITESTREAM_CONFIG" -o "$DEST" "$LIVE_DB"

echo
echo "[2/4] Restored file size:"
ls -lh "$DEST"

echo
echo "[3/4] Running integrity check..."
if [ -f "$INTEGRITY_SCRIPT" ]; then
  node "$INTEGRITY_SCRIPT" "$DEST"
else
  echo "WARNING: $INTEGRITY_SCRIPT not found — falling back to PRAGMA integrity_check"
  sqlite3 "$DEST" "PRAGMA integrity_check;"
fi

echo
echo "[4/4] Quick row sanity (should be > 0 for a real DB):"
sqlite3 "$DEST" "SELECT name FROM sqlite_master WHERE type='table' LIMIT 5;" || true
sqlite3 "$DEST" "SELECT COUNT(*) AS table_count FROM sqlite_master WHERE type='table';" || true

echo
echo "================================================================"
echo " DRILL COMPLETE"
echo "================================================================"
echo " If integrity check passed and table count > 0, the R2 backup"
echo " chain is recoverable. Delete the test artifact when done:"
echo "   rm -f $DEST ${DEST}-shm ${DEST}-wal"
echo "================================================================"
