#!/bin/bash
# Prunes Pawtropolis database backups in two places:
#   data/backups/data.db.<timestamp>   (deploy snapshots)
#   data/data.db.backup-<timestamp>    (scripts/migrate.ts)
# In each, keeps the newest KEEP_NEWEST and anything from the last RETAIN_DAYS days; a backup's
# -wal/-shm siblings go with it. DRY_RUN=1 only logs. Run daily from cron (04:00).

set -euo pipefail

DATA_DIR="${DATA_DIR:-/home/ubuntu/pawtropolis-tech/data}"
KEEP_NEWEST="${KEEP_NEWEST:-3}"
RETAIN_DAYS="${RETAIN_DAYS:-7}"
BACKUP_LOG="${BACKUP_LOG:-/tmp/backup-cleanup.log}"
DRY_RUN="${DRY_RUN:-0}"

ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log() { echo "[$(ts)] $*" | tee -a "$BACKUP_LOG"; }

total=0
prune() {   # prune <dir> <glob>
	local dir=$1 glob=$2 n=0 base size
	[ -d "$dir" ] || return 0
	mapfile -t bases < <(cd "$dir" && ls -1t $glob 2>/dev/null | grep -v -E -- '-(wal|shm)$' || true)
	for base in "${bases[@]}"; do
		[ -n "$base" ] || continue
		n=$((n + 1))
		[ "$n" -le "$KEEP_NEWEST" ] && continue
		find "$dir/$base" -maxdepth 0 -mtime "-$RETAIN_DAYS" -print -quit | grep -q . && continue
		size=$({ stat -c %s "$dir/$base" "$dir/$base-wal" "$dir/$base-shm" 2>/dev/null || true; } | awk '{s+=$1} END {print s+0}')
		total=$((total + size))
		if [ "$DRY_RUN" = 1 ]; then
			log "would delete $dir/$base (+wal/shm, $((size / 1048576)) MB)"
		else
			rm -f -- "$dir/$base" "$dir/$base-wal" "$dir/$base-shm"
			log "deleted $dir/$base (+wal/shm, $((size / 1048576)) MB)"
		fi
	done
}

prune "$DATA_DIR/backups" 'data.db.*'
prune "$DATA_DIR" 'data.db.backup-*'
if [ "$DRY_RUN" = 1 ]; then verb="dry run: would free"; else verb="freed"; fi
log "$verb $((total / 1048576)) MB (kept newest $KEEP_NEWEST + last $RETAIN_DAYS days per folder)"
