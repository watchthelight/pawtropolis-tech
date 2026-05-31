#!/bin/bash
# Thin wrapper: delegate to the hardened deploy.sh in --fast (skip-tests) mode.
#
# This script used to be a separate, divergent deploy path with NO deploy lock,
# NO pre-deploy DB backup, and the same `|| echo` that swallowed migration
# failures (#00088). That is exactly the wrong shape for the documented rollback
# recipe, where you most need the lock and a fresh backup. deploy.sh --fast
# already provides the mkdir lock, the migration-abort guard, and (with
# BACKUP_BEFORE_DEPLOY=1) a pre-deploy backup. Force the backup and reuse it
# rather than maintaining a second, unsafe code path.
#
# Note: a code rollback (git checkout HEAD~1) does NOT revert migrations - the
# runner only moves forward. After rolling back code you may be on a newer schema.
set -euo pipefail

cd "$(dirname "$0")"
exec env BACKUP_BEFORE_DEPLOY=1 ./deploy.sh --fast "$@"
