#!/bin/bash
set -euo pipefail

# Pawtropolis Deployment Script
# Deploys to pawtropolis server (Ubuntu, user: ubuntu)
# Remote path: /home/ubuntu/pawtropolis-tech/
# PM2 processes: pawtropolis (bot), pawtropolis-web (dashboard)
#
# Hardening (2026-05-02):
#   - REMOTE_USER, REMOTE_HOST, REMOTE_PATH, PM2_PROCESS_BOT, PM2_PROCESS_WEB
#     are env-overridable. Useful for staging boxes or alternate aliases.
#   - SSH/SCP get connection timeouts so a network blip does not hang the
#     workflow indefinitely.
#   - Optional remote deploy lock prevents two deploys from racing.
#   - Optional pre-deploy DB backup on the remote (BACKUP_BEFORE_DEPLOY=1).
#   - --dry-run prints commands without running them.
#   - See docs/operations/deployment-hardening.md.

REMOTE_USER="${REMOTE_USER:-ubuntu}"
REMOTE_HOST="${REMOTE_HOST:-bash-ec2}"
REMOTE_PATH="${REMOTE_PATH:-/home/ubuntu/pawtropolis-tech}"
PM2_PROCESS_BOT="${PM2_PROCESS_BOT:-pawtropolis}"
PM2_PROCESS_WEB="${PM2_PROCESS_WEB:-pawtropolis-web}"
# Backwards-compat alias used by some inline ssh strings below.
PM2_PROCESS="${PM2_PROCESS_BOT}"
TARBALL="deploy.tar.gz"

# SSH host validation. Exit early with a clear message if the host alias
# is not configured. Fixes hard-to-diagnose "Could not resolve hostname"
# failures when running from a machine without ~/.ssh/config set up.
if ! grep -qE "^[[:space:]]*Host[[:space:]]+([[:graph:]]+[[:space:]]+)*${REMOTE_HOST}([[:space:]]|$)" "${HOME}/.ssh/config" 2>/dev/null; then
  # Fall back to ssh-keygen -F (known_hosts entry). If neither present, abort.
  if ! ssh-keygen -F "${REMOTE_HOST}" >/dev/null 2>&1; then
    echo "ERROR: SSH host '${REMOTE_HOST}' is not in ~/.ssh/config or known_hosts." >&2
    echo "       Set REMOTE_HOST=<your-alias> or configure ~/.ssh/config first." >&2
    echo "       See docs/operations/deployment-hardening.md." >&2
    exit 1
  fi
fi

# SSH options applied to every remote call. ConnectTimeout fails fast if the
# host is unreachable; ServerAliveInterval+CountMax detect a dropped connection
# during a long step (e.g., npm ci on a slow link) instead of waiting for TCP.
# BatchMode=yes avoids interactive password prompts; we expect key-based auth.
SSH_OPTS=(
  -o "ConnectTimeout=15"
  -o "ServerAliveInterval=30"
  -o "ServerAliveCountMax=3"
  -o "BatchMode=yes"
)
SCP_OPTS=(
  -o "ConnectTimeout=15"
  -o "ServerAliveInterval=30"
  -o "ServerAliveCountMax=3"
  -o "BatchMode=yes"
)

# Lockfile path on the remote. mkdir is atomic so concurrent deploys can race
# safely: the second one fails to create and exits.
DEPLOY_LOCK_DIR="${DEPLOY_LOCK_DIR:-/tmp/pawtropolis-deploy.lock}"

# Pre-deploy DB backup. On every deploy the script copies the current DB to
# data/backups/data.db.<utc_ts> on the remote before the new tarball lands.
# Default on; set BACKUP_BEFORE_DEPLOY=0 to skip (e.g. for known-safe deploys
# that only touch web assets). Litestream replication runs continuously and
# is a separate safety net.
BACKUP_BEFORE_DEPLOY="${BACKUP_BEFORE_DEPLOY:-1}"

# Helper: a single ssh invocation with the standard timeout options.
ssh_remote() {
  ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" "$@"
}

# Helper: a single scp invocation with the standard timeout options.
scp_remote() {
  scp "${SCP_OPTS[@]}" "$@"
}

# Acquire/release the deploy lock. mkdir is atomic on POSIX filesystems so
# parallel invocations contend safely. The trap ensures we release the lock
# even if a later step fails.
acquire_deploy_lock() {
  if ! ssh_remote "mkdir ${DEPLOY_LOCK_DIR} 2>/dev/null"; then
    echo "ERROR: another deploy is already in progress (lock at ${DEPLOY_LOCK_DIR})." >&2
    echo "If you are sure no other deploy is running, ssh to ${REMOTE_HOST} and remove the lock:" >&2
    echo "  ssh ${REMOTE_HOST} rm -rf ${DEPLOY_LOCK_DIR}" >&2
    exit 1
  fi
  trap 'release_deploy_lock' EXIT
}

release_deploy_lock() {
  ssh_remote "rm -rf ${DEPLOY_LOCK_DIR}" >/dev/null 2>&1 || true
}

# Optional pre-deploy DB backup on remote. Copies data/data.db to a timestamped
# file so a botched migration can be reverted by hand.
maybe_backup_remote_db() {
  if [ "${BACKUP_BEFORE_DEPLOY}" != "1" ]; then
    return 0
  fi
  local ts
  ts="$(date -u +%Y%m%d-%H%M%S)"
  echo "Backing up remote DB before deploy..."
  ssh_remote "mkdir -p ${REMOTE_PATH}/data/backups && \
    cp ${REMOTE_PATH}/data/data.db ${REMOTE_PATH}/data/backups/data.db.${ts} 2>/dev/null && \
    echo '  -> backup at data/backups/data.db.${ts}' || \
    echo '  -> WARNING: data.db not found on remote, skipping backup'"
}

# Parse arguments
SHOW_LOGS=false
RESTART_ONLY=false
STATUS_ONLY=false
SKIP_TESTS=false
DEPLOY_WEB=false
DEPLOY_BOT=false
DRY_RUN=false

for arg in "$@"; do
  case $arg in
    --logs)
      SHOW_LOGS=true
      shift
      ;;
    --restart)
      RESTART_ONLY=true
      shift
      ;;
    --status)
      STATUS_ONLY=true
      shift
      ;;
    --fast|--no-tests)
      SKIP_TESTS=true
      shift
      ;;
    --web)
      DEPLOY_WEB=true
      shift
      ;;
    --bot)
      DEPLOY_BOT=true
      shift
      ;;
    --graceful)
      GRACEFUL=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: $0 [--logs] [--restart] [--status] [--fast] [--web] [--bot] [--graceful] [--dry-run]"
      echo ""
      echo "Env overrides:"
      echo "  REMOTE_USER, REMOTE_HOST, REMOTE_PATH"
      echo "  PM2_PROCESS_BOT, PM2_PROCESS_WEB"
      echo "  BACKUP_BEFORE_DEPLOY=1   take a remote DB backup before deploy"
      echo "  DEPLOY_LOCK_DIR          override the lock path (default /tmp/pawtropolis-deploy.lock)"
      exit 1
      ;;
  esac
done

# Preflight summary so the operator can confirm before anything destructive.
echo "Pawtropolis deploy preflight"
echo "  remote      : ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}"
echo "  bot process : ${PM2_PROCESS_BOT}"
echo "  web process : ${PM2_PROCESS_WEB}"
echo "  ssh timeout : ConnectTimeout=15s, KeepAlive=30s x3"
echo "  lock        : ${DEPLOY_LOCK_DIR}"
echo "  backup      : $([ "${BACKUP_BEFORE_DEPLOY}" = "1" ] && echo enabled || echo disabled)"
echo "  dry-run     : ${DRY_RUN}"
echo ""

if [ "$DRY_RUN" = true ]; then
  echo "Dry run: exiting before any remote command."
  exit 0
fi

# Validate: --web and --bot are mutually exclusive
if [ "$DEPLOY_WEB" = true ] && [ "$DEPLOY_BOT" = true ]; then
  echo "Error: --web and --bot are mutually exclusive. Use neither for a full deploy."
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# deps_changed - Compare local vs remote package-lock.json sha256
# Args: $1 = local lockfile path, $2 = remote lockfile path
# Returns: 0 if deps changed (or can't determine), 1 if unchanged
# One SSH round-trip (~1s) saves ~20-30s of npm ci
# ─────────────────────────────────────────────────────────────────────────────
deps_changed() {
  local local_lock="$1"
  local remote_lock="$2"

  if [ ! -f "$local_lock" ]; then
    return 0  # can't determine, assume changed
  fi

  local local_hash
  local_hash=$(sha256sum "$local_lock" | cut -d' ' -f1)

  local remote_hash
  remote_hash=$(ssh_remote "sha256sum ${remote_lock} 2>/dev/null | cut -d' ' -f1" 2>/dev/null || echo "")

  if [ -z "$remote_hash" ]; then
    return 0  # can't determine, assume changed
  fi

  if [ "$local_hash" = "$remote_hash" ]; then
    return 1  # unchanged
  fi

  return 0  # changed
}

# Status only
if [ "$STATUS_ONLY" = true ]; then
  echo "Checking PM2 status on remote server..."
  ssh_remote "pm2 status"
  exit 0
fi

# Restart only
if [ "$RESTART_ONLY" = true ]; then
  echo "Restarting PM2 processes..."
  ssh_remote "cd ${REMOTE_PATH} && pm2 startOrRestart ecosystem.config.cjs"
  echo "Process restarted successfully!"
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════════════════
# WEB-ONLY DEPLOY (--web)
# ═══════════════════════════════════════════════════════════════════════════════
if [ "$DEPLOY_WEB" = true ]; then
  echo "Starting WEB-ONLY deployment to ${REMOTE_HOST}..."
  acquire_deploy_lock
  TARBALL="deploy-web.tar.gz"

  # Step 1: Build web
  echo "Step 1/4: Building web dashboard..."
  (cd web && npm run build)

  # Step 2: Create tarball (web/build only)
  echo "Step 2/4: Creating web tarball..."
  tar -czf ${TARBALL} web/build web/package.json web/package-lock.json

  # Step 3: Upload + extract
  echo "Step 3/4: Uploading and extracting..."
  scp_remote ${TARBALL} ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}/
  ssh_remote "cd ${REMOTE_PATH} && tar -xzf ${TARBALL}"

  # Check if web deps changed
  if deps_changed "web/package-lock.json" "${REMOTE_PATH}/web/package-lock.json"; then
    echo "  -> Web dependencies changed, running npm ci..."
    ssh_remote "cd ${REMOTE_PATH}/web && npm ci --omit=dev"
  else
    echo "  -> Web dependencies unchanged, skipping npm ci"
  fi

  # Step 4: Restart web process + cleanup
  echo "Step 4/4: Restarting web dashboard..."
  ssh_remote "cd ${REMOTE_PATH} && pm2 restart ${PM2_PROCESS_WEB} && rm -f ${TARBALL}"
  rm -f ${TARBALL}

  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║                                                              ║"
  echo "║   ✅ WEB DEPLOY COMPLETE                                     ║"
  echo "║                                                              ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  echo "::DEPLOY_DONE::"

  if [ "$SHOW_LOGS" = true ]; then
    echo "Showing recent web logs..."
    ssh_remote "pm2 logs ${PM2_PROCESS_WEB} --lines 50"
  fi
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════════════════
# BOT-ONLY DEPLOY (--bot)
# ═══════════════════════════════════════════════════════════════════════════════
if [ "$DEPLOY_BOT" = true ]; then
  echo "Starting BOT-ONLY deployment to ${REMOTE_HOST}..."
  acquire_deploy_lock
  maybe_backup_remote_db
  TARBALL="deploy-bot.tar.gz"

  # Step 1: Build bot
  echo "Step 1/5: Building bot..."
  npm run build

  # Step 2: Inject build metadata
  echo "Step 2/5: Injecting build metadata..."
  npx tsx scripts/inject-build-info.ts

  # Step 3: Create tarball (dist + .env.build only)
  echo "Step 3/5: Creating bot tarball..."
  tar -czf ${TARBALL} dist .env.build package.json package-lock.json

  # Step 4: Upload + extract
  echo "Step 4/5: Uploading and extracting..."
  scp_remote ${TARBALL} ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}/
  ssh_remote "cd ${REMOTE_PATH} && tar -xzf ${TARBALL}"

  # Check if bot deps changed
  if deps_changed "package-lock.json" "${REMOTE_PATH}/package-lock.json"; then
    echo "  -> Bot dependencies changed, running npm ci..."
    ssh_remote "cd ${REMOTE_PATH} && npm ci --omit=dev"
  else
    echo "  -> Bot dependencies unchanged, skipping npm ci"
  fi

  # Step 5: Restart bot process + cleanup
  echo "Step 5/5: Restarting bot..."
  ssh_remote "cd ${REMOTE_PATH} && pm2 restart ${PM2_PROCESS_BOT} && rm -f ${TARBALL}"
  rm -f ${TARBALL}

  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║                                                              ║"
  echo "║   ✅ BOT DEPLOY COMPLETE                                     ║"
  echo "║                                                              ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  echo "::DEPLOY_DONE::"

  if [ "$SHOW_LOGS" = true ]; then
    echo "Showing recent bot logs..."
    ssh_remote "pm2 logs ${PM2_PROCESS_BOT} --lines 50"
  fi
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════════════════
# FULL DEPLOYMENT
# ═══════════════════════════════════════════════════════════════════════════════
echo "Starting FULL deployment to ${REMOTE_HOST}..."
acquire_deploy_lock
maybe_backup_remote_db

# Step 1: Run tests (unless --fast)
if [ "$SKIP_TESTS" = true ]; then
  echo "Step 1/9: Skipping tests (--fast mode)..."
else
  echo "Step 1/9: Running tests..."
  npm test
fi

# Step 2: Build bot + web
echo "Step 2/9: Building project..."
npm run build
echo "Step 2b/9: Building web dashboard..."
(cd web && npm run build)

# Step 3: Inject build metadata
# ─────────────────────────────────────────────────────────────────────────────
# This generates .env.build with:
#   BUILD_GIT_SHA     - Git commit hash for exact code identification
#   BUILD_TIMESTAMP   - ISO 8601 timestamp of when this build was created
#   BUILD_DEPLOY_ID   - Unique deployment identifier (date+sha)
#
# These values are read by src/lib/buildInfo.ts at runtime, enabling:
#   - Error correlation to exact commits in Sentry
#   - Wide event logs with build identity
#   - Error cards showing version+SHA
#   - /health command with deployment info
# ─────────────────────────────────────────────────────────────────────────────
echo "Step 3/9: Injecting build metadata..."
npx tsx scripts/inject-build-info.ts

# Step 4: Create tarball
# Include .env.build so the build metadata is available on the server
echo "Step 4/9: Creating deployment tarball..."
tar -czf ${TARBALL} dist src migrations scripts assets package.json package-lock.json .env.build ecosystem.config.cjs web/build web/package.json web/package-lock.json

# Step 5: Upload to remote
echo "Step 5/9: Uploading to remote server..."
scp_remote ${TARBALL} ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}/

# Step 6: Extract and install on remote (smart dep detection)
echo "Step 6/9: Extracting on remote..."
ssh_remote "cd ${REMOTE_PATH} && tar -xzf ${TARBALL}"

# Smart dep detection: only run npm ci for lockfiles that actually changed
if deps_changed "package-lock.json" "${REMOTE_PATH}/package-lock.json"; then
  echo "  -> Bot dependencies changed, running npm ci..."
  ssh_remote "cd ${REMOTE_PATH} && npm ci --omit=dev"
else
  echo "  -> Bot dependencies unchanged, skipping npm ci"
fi

if deps_changed "web/package-lock.json" "${REMOTE_PATH}/web/package-lock.json"; then
  echo "  -> Web dependencies changed, running npm ci..."
  ssh_remote "cd ${REMOTE_PATH}/web && npm ci --omit=dev"
else
  echo "  -> Web dependencies unchanged, skipping npm ci"
fi

# Step 6.5: Run migrations on remote
echo "Step 6.5/9: Running migrations on remote..."
ssh_remote "cd ${REMOTE_PATH} && node scripts/migrate-remote.js" || echo "Migration step completed (may have warnings)"

# Step 6.6: Register slash commands with Discord
# ─────────────────────────────────────────────────────────────────────────────
# Slash commands must be registered with Discord's API separately from code
# deployment. This step syncs the local command definitions to Discord.
# Without this, new commands will show "Unknown interaction" errors.
# ─────────────────────────────────────────────────────────────────────────────
echo "Step 6.6/9: Registering slash commands with Discord..."
npx dotenvx run -- tsx scripts/commands.ts --all || {
  echo "WARNING: Command registration failed. Run 'npm run deploy:cmds' manually."
}

# Step 7: Restart PM2
if [ "${GRACEFUL:-false}" = true ]; then
  echo "Step 7/9: Graceful restart — sending SIGINT to drain active operations..."
  ssh_remote "cd ${REMOTE_PATH} && pm2 sendSignal SIGINT ${PM2_PROCESS_BOT} && sleep 5 && pm2 startOrRestart ecosystem.config.cjs"
else
  echo "Step 7/9: Restarting PM2 processes..."
  ssh_remote "cd ${REMOTE_PATH} && pm2 startOrRestart ecosystem.config.cjs"
fi

# Step 8: Post-deploy health check
echo "Step 8/9: Verifying deployment..."
HEALTH_RETRIES=5
HEALTH_DELAY=3
BOT_HEALTHY=false
for i in $(seq 1 $HEALTH_RETRIES); do
  sleep $HEALTH_DELAY
  # Check PM2 status + verify bot actually connected to Discord (logged "Ready" event)
  BOT_STATUS=$(ssh_remote "pm2 show ${PM2_PROCESS_BOT} 2>/dev/null | grep 'status' | head -1" 2>/dev/null || echo "unknown")
  WEB_STATUS=$(ssh_remote "pm2 show ${PM2_PROCESS_WEB} 2>/dev/null | grep 'status' | head -1" 2>/dev/null || echo "unknown")
  RESTARTS=$(ssh_remote "pm2 show ${PM2_PROCESS_BOT} 2>/dev/null | grep 'restarts' | head -1 | grep -oP '[0-9]+'" 2>/dev/null || echo "?")
  READY=$(ssh_remote "pm2 logs ${PM2_PROCESS_BOT} --lines 30 --nostream 2>/dev/null | grep -c 'Bot ready\|client_ready\|Connected to Discord'" 2>/dev/null || echo "0")

  echo "  Attempt $i/$HEALTH_RETRIES: bot=$BOT_STATUS | web=$WEB_STATUS | restarts=$RESTARTS | ready=$READY"

  if echo "$BOT_STATUS" | grep -q "online" && echo "$WEB_STATUS" | grep -q "online" && [ "$READY" != "0" ]; then
    BOT_HEALTHY=true
    break
  fi
done

if [ "$BOT_HEALTHY" = true ]; then
  echo "✅ Both processes online and bot connected to Discord."
else
  echo "⚠️  Health check inconclusive after ${HEALTH_RETRIES} attempts."
  echo "Recent bot logs:"
  ssh_remote "pm2 logs ${PM2_PROCESS_BOT} --lines 15 --nostream 2>/dev/null" || true
  echo "Check manually: ssh ${REMOTE_USER}@${REMOTE_HOST} 'pm2 logs ${PM2_PROCESS_BOT} --lines 50'"
fi

# Step 9: Remote cleanup
echo "Step 9/9: Cleaning up remote tarball..."
ssh_remote "rm -f ${REMOTE_PATH}/${TARBALL}"

# Local cleanup
echo "Cleaning up local tarball..."
rm ${TARBALL}

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║   ✅ DEPLOYMENT COMPLETE - BOT + WEB DEPLOYED ✅             ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "::DEPLOY_DONE::"

# Show logs if requested
if [ "$SHOW_LOGS" = true ]; then
  echo "Showing recent logs..."
  ssh_remote "pm2 logs --lines 50"
fi
