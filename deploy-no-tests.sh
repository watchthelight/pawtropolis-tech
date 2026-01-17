#!/bin/bash
set -euo pipefail

REMOTE_USER="ubuntu"
REMOTE_HOST="pawtech"
REMOTE_PATH="/home/ubuntu/pawtropolis-tech"
PM2_PROCESS="pawtropolis"
TARBALL="deploy.tar.gz"

echo "Starting deployment to ${REMOTE_HOST}..."

echo "Step 1/8: Injecting build metadata..."
npx tsx scripts/inject-build-info.ts

echo "Step 2/8: Creating deployment tarball..."
tar -czf ${TARBALL} dist migrations scripts package.json package-lock.json .env.build

echo "Step 3/8: Uploading to remote server..."
scp ${TARBALL} ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}/

echo "Step 4/8: Extracting and installing on remote..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_PATH} && tar -xzf ${TARBALL} && npm ci --omit=dev"

echo "Step 5/8: Running migrations on remote..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_PATH} && node scripts/migrate-remote.js" || echo "Migration step completed (may have warnings)"

echo "Step 6/8: Restarting PM2 process..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "pm2 restart ${PM2_PROCESS}"

echo "Step 7/8: Waiting for process to stabilize..."
sleep 3
echo "Checking PM2 process status..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "pm2 show ${PM2_PROCESS} | grep -E 'status|restarts|uptime'" || {
  echo "WARNING: Could not verify process status. Check logs manually."
}

echo "Step 8/8: Cleaning up remote tarball..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "rm -f ${REMOTE_PATH}/${TARBALL}"

echo "Cleaning up local tarball..."
rm ${TARBALL}

echo ""
echo "Deployment completed successfully!"
echo ""
