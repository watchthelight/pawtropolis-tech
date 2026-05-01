#!/bin/bash
# Keeps the newest N data.db backups in BACKUP_DIR and any from the last RETAIN_DAYS days.
# Logs deletions to BACKUP_LOG.
#
# Defaults: keep 3 newest + anything from the last 7 days.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/home/ubuntu/pawtropolis-tech/data}"
KEEP_NEWEST="${KEEP_NEWEST:-3}"
RETAIN_DAYS="${RETAIN_DAYS:-7}"
BACKUP_LOG="${BACKUP_LOG:-/tmp/backup-cleanup.log}"

ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log() { echo "[$(ts)] $*" | tee -a "$BACKUP_LOG"; }

cd "$BACKUP_DIR"

# Newest N backup paths (won't be touched).
mapfile -t KEEP < <(ls -1t data.db.backup-* 2>/dev/null | head -n "$KEEP_NEWEST")

# Files to inspect = all backups not in KEEP list.
to_delete=()
while IFS= read -r f; do
	skip=0
	for k in "${KEEP[@]}"; do [ "$f" = "$k" ] && skip=1 && break; done
	[ "$skip" -eq 1 ] && continue

	# Skip if modified within RETAIN_DAYS days.
	if find "$f" -maxdepth 0 -mtime "-$RETAIN_DAYS" -print -quit | grep -q .; then
		continue
	fi
	to_delete+=("$f")
done < <(ls -1 data.db.backup-* 2>/dev/null)

if [ "${#to_delete[@]}" -eq 0 ]; then
	log "no backups to delete (kept newest $KEEP_NEWEST + last $RETAIN_DAYS days)"
	exit 0
fi

before_kb=$(du -sk . | cut -f1)
for f in "${to_delete[@]}"; do
	size=$(stat -c '%s' "$f" 2>/dev/null || echo 0)
	rm -f -- "$f"
	log "deleted $f ($((size / 1024 / 1024)) MB)"
done
after_kb=$(du -sk . | cut -f1)
log "freed $(( (before_kb - after_kb) / 1024 )) MB total"
