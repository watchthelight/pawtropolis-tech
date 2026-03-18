#!/bin/bash
set -euo pipefail

# Pawtropolis Deployment Script
# Deploys to pawtropolis server (Ubuntu, user: ubuntu)
# Remote path: /home/ubuntu/pawtropolis-tech/
# PM2 processes: pawtropolis (bot), pawtropolis-web (dashboard)

REMOTE_USER="ubuntu"
REMOTE_HOST="bash-ec2"
REMOTE_PATH="/home/ubuntu/pawtropolis-tech"
PM2_PROCESS="pawtropolis"
TARBALL="deploy.tar.gz"

# Parse arguments
SHOW_LOGS=false
RESTART_ONLY=false
STATUS_ONLY=false
SKIP_TESTS=false
DEPLOY_WEB=false
DEPLOY_BOT=false

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
    *)
      echo "Unknown argument: $arg"
      echo "Usage: $0 [--logs] [--restart] [--status] [--fast] [--web] [--bot]"
      exit 1
      ;;
  esac
done

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
  remote_hash=$(ssh ${REMOTE_USER}@${REMOTE_HOST} "sha256sum ${remote_lock} 2>/dev/null | cut -d' ' -f1" 2>/dev/null || echo "")

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
  ssh ${REMOTE_USER}@${REMOTE_HOST} "pm2 status"
  exit 0
fi

# Restart only
if [ "$RESTART_ONLY" = true ]; then
  echo "Restarting PM2 processes..."
  ssh ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_PATH} && pm2 startOrRestart ecosystem.config.cjs"
  echo "Process restarted successfully!"
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════════════════
# WEB-ONLY DEPLOY (--web)
# ═══════════════════════════════════════════════════════════════════════════════
if [ "$DEPLOY_WEB" = true ]; then
  echo "Starting WEB-ONLY deployment to ${REMOTE_HOST}..."
  TARBALL="deploy-web.tar.gz"

  # Step 1: Build web
  echo "Step 1/4: Building web dashboard..."
  (cd web && npm run build)

  # Step 2: Create tarball (web/build only)
  echo "Step 2/4: Creating web tarball..."
  tar -czf ${TARBALL} web/build web/package.json web/package-lock.json

  # Step 3: Upload + extract
  echo "Step 3/4: Uploading and extracting..."
  scp ${TARBALL} ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}/
  ssh ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_PATH} && tar -xzf ${TARBALL}"

  # Check if web deps changed
  if deps_changed "web/package-lock.json" "${REMOTE_PATH}/web/package-lock.json"; then
    echo "  -> Web dependencies changed, running npm ci..."
    ssh ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_PATH}/web && npm ci --omit=dev"
  else
    echo "  -> Web dependencies unchanged, skipping npm ci"
  fi

  # Step 4: Restart web process + cleanup
  echo "Step 4/4: Restarting web dashboard..."
  ssh ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_PATH} && pm2 restart pawtropolis-web && rm -f ${TARBALL}"
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
    ssh ${REMOTE_USER}@${REMOTE_HOST} "pm2 logs pawtropolis-web --lines 50"
  fi
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════════════════
# BOT-ONLY DEPLOY (--bot)
# ═══════════════════════════════════════════════════════════════════════════════
if [ "$DEPLOY_BOT" = true ]; then
  echo "Starting BOT-ONLY deployment to ${REMOTE_HOST}..."
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
  scp ${TARBALL} ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}/
  ssh ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_PATH} && tar -xzf ${TARBALL}"

  # Check if bot deps changed
  if deps_changed "package-lock.json" "${REMOTE_PATH}/package-lock.json"; then
    echo "  -> Bot dependencies changed, running npm ci..."
    ssh ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_PATH} && npm ci --omit=dev"
  else
    echo "  -> Bot dependencies unchanged, skipping npm ci"
  fi

  # Step 5: Restart bot process + cleanup
  echo "Step 5/5: Restarting bot..."
  ssh ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_PATH} && pm2 restart pawtropolis && rm -f ${TARBALL}"
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
    ssh ${REMOTE_USER}@${REMOTE_HOST} "pm2 logs pawtropolis --lines 50"
  fi
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════════════════
# FULL DEPLOYMENT
# ═══════════════════════════════════════════════════════════════════════════════
echo "Starting FULL deployment to ${REMOTE_HOST}..."

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
scp ${TARBALL} ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}/

# Step 6: Extract and install on remote (smart dep detection)
echo "Step 6/9: Extracting on remote..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_PATH} && tar -xzf ${TARBALL}"

# Smart dep detection: only run npm ci for lockfiles that actually changed
if deps_changed "package-lock.json" "${REMOTE_PATH}/package-lock.json"; then
  echo "  -> Bot dependencies changed, running npm ci..."
  ssh ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_PATH} && npm ci --omit=dev"
else
  echo "  -> Bot dependencies unchanged, skipping npm ci"
fi

if deps_changed "web/package-lock.json" "${REMOTE_PATH}/web/package-lock.json"; then
  echo "  -> Web dependencies changed, running npm ci..."
  ssh ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_PATH}/web && npm ci --omit=dev"
else
  echo "  -> Web dependencies unchanged, skipping npm ci"
fi

# Step 6.5: Run migrations on remote
echo "Step 6.5/9: Running migrations on remote..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_PATH} && node scripts/migrate-remote.js" || echo "Migration step completed (may have warnings)"

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
echo "Step 7/9: Restarting PM2 processes..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_PATH} && pm2 startOrRestart ecosystem.config.cjs"

# Step 8: Post-deploy health check
echo "Step 8/9: Waiting for process to stabilize..."
sleep 3
echo "Checking PM2 process status..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "pm2 show pawtropolis | grep -E 'status|restarts|uptime' && echo '---' && pm2 show pawtropolis-web | grep -E 'status|restarts|uptime'" || {
  echo "WARNING: Could not verify process status. Check logs manually."
}

# Step 9: Remote cleanup
echo "Step 9/9: Cleaning up remote tarball..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "rm -f ${REMOTE_PATH}/${TARBALL}"

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
  ssh ${REMOTE_USER}@${REMOTE_HOST} "pm2 logs --lines 50"
fi
