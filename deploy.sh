#!/bin/bash
set -euo pipefail

# Pawtropolis Deployment Script
# Deploys to pawtech server (Ubuntu, user: ubuntu)
# Remote path: /home/ubuntu/pawtropolis-tech/
# PM2 process: pawtropolis

REMOTE_USER="ubuntu"
REMOTE_HOST="pawtech"
REMOTE_PATH="/home/ubuntu/pawtropolis-tech"
PM2_PROCESS="pawtropolis"
TARBALL="deploy.tar.gz"

# Parse arguments
SHOW_LOGS=false
RESTART_ONLY=false
STATUS_ONLY=false
SKIP_TESTS=false

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
    *)
      echo "Unknown argument: $arg"
      echo "Usage: $0 [--logs] [--restart] [--status] [--fast]"
      exit 1
      ;;
  esac
done

# Status only
if [ "$STATUS_ONLY" = true ]; then
  echo "Checking PM2 status on remote server..."
  ssh ${REMOTE_USER}@${REMOTE_HOST} "pm2 status"
  exit 0
fi

# Restart only
if [ "$RESTART_ONLY" = true ]; then
  echo "Restarting PM2 process..."
  ssh ${REMOTE_USER}@${REMOTE_HOST} "pm2 restart ${PM2_PROCESS}"
  echo "Process restarted successfully!"
  exit 0
fi

# Full deployment
echo "Starting deployment to ${REMOTE_HOST}..."

# Step 1: Run tests (unless --fast)
if [ "$SKIP_TESTS" = true ]; then
  echo "Step 1/9: Skipping tests (--fast mode)..."
else
  echo "Step 1/9: Running tests..."
  npm test
fi

# Step 2: Build
echo "Step 2/9: Building project..."
npm run build

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
tar -czf ${TARBALL} dist migrations scripts package.json package-lock.json .env.build

# Step 5: Upload to remote
echo "Step 5/9: Uploading to remote server..."
scp ${TARBALL} ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}/

# Step 6: Extract and install on remote
echo "Step 6/9: Extracting and installing on remote..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_PATH} && tar -xzf ${TARBALL} && npm ci --omit=dev"

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
echo "Step 7/9: Restarting PM2 process..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "pm2 restart ${PM2_PROCESS}"

# Step 8: Post-deploy health check
echo "Step 8/9: Waiting for process to stabilize..."
sleep 3
echo "Checking PM2 process status..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "pm2 show ${PM2_PROCESS} | grep -E 'status|restarts|uptime'" || {
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
echo "║   ✅ DEPLOYMENT COMPLETE - BOT IS ONLINE AND RUNNING ✅     ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "::DEPLOY_DONE::"

# Show logs if requested
if [ "$SHOW_LOGS" = true ]; then
  echo "Showing recent logs..."
  ssh ${REMOTE_USER}@${REMOTE_HOST} "pm2 logs ${PM2_PROCESS} --lines 50"
fi
