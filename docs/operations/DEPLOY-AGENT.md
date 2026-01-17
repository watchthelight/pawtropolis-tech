# Deploy Agent Guide

This document describes how the `deploy-changes` agent operates and its verification workflow.

## Overview

The deploy-changes agent is a Claude Code subagent specialized for deploying code changes to the Pawtropolis Tech production server. It uses the Haiku model for fast execution.

**Key characteristics:**
- Direct deployment via rsync/scp (no GitHub)
- Pre-deploy test verification
- Post-deploy health checks
- User-prompted decisions on failures

## When to Use

Invoke the deploy agent when you want to:
- Deploy code changes to production
- Run migrations on the remote server
- Sync slash command definitions

**Example invocations:**
```
"Deploy the latest changes"
"Deploy and run the new migration"
"Push the build to production"
```

## Deployment Workflow

### Step 1: Test Verification

The agent runs `npm test` before deploying.

**If tests pass:** Proceeds to deployment.

**If tests fail:** The agent will **stop and ask** you:
> "Tests failed with the following errors: [errors]. Do you want to proceed with deployment anyway?"

You must explicitly approve to continue.

### Step 2: Build and Deploy

If tests pass (or you approved despite failures), the agent runs:

```bash
npm run build && ./deploy.sh
```

This:
1. Compiles TypeScript
2. Injects build metadata (git SHA, timestamp)
3. Creates deployment tarball
4. Uploads to remote server
5. Installs dependencies
6. Restarts PM2 process

### Step 3: Post-Deploy Verification

After deployment, the agent runs the smoke test:

```bash
./scripts/smoke-test.sh
```

This verifies:
- Health endpoint responds at `http://3.209.223.216:3002/api/health`
- Bot status is "online"
- WebSocket latency is reasonable (<500ms)
- PM2 process is running

### Step 4: Issue Handling

**If verification fails:** The agent will **stop and ask**:
> "Health check failed: [error details]. Do you want to rollback to the previous version?"

If you approve rollback:
```bash
git checkout HEAD~1 && ./deploy-no-tests.sh
```

## Migrations

If you mention a new migration, the agent runs it after deploy:

```bash
ssh pawtech 'cd ~/pawtropolis-tech && npm run migrate'
```

## Command Definition Sync

If slash command definitions changed, tell the agent to sync them:

```bash
npm run deploy:cmds
```

## Manual Verification Commands

If you want to verify manually:

```bash
# Check health endpoint
curl http://3.209.223.216:3002/api/health

# Check PM2 status
ssh pawtech 'pm2 status pawtropolis'

# View recent logs
ssh pawtech 'pm2 logs pawtropolis --lines 50'

# Full smoke test
./scripts/smoke-test.sh
```

## Rollback Procedure

To rollback to a previous deployment:

```bash
# Go back one commit
git checkout HEAD~1

# Deploy without running tests (they passed before)
./deploy-no-tests.sh
```

For multiple commits back:
```bash
git checkout HEAD~3  # Go back 3 commits
./deploy-no-tests.sh
```

## Troubleshooting

### Health Check Fails

1. Check if the bot process is running:
   ```bash
   ssh pawtech 'pm2 status'
   ```

2. Check logs for errors:
   ```bash
   ssh pawtech 'pm2 logs pawtropolis --lines 100'
   ```

3. Try restarting:
   ```bash
   ssh pawtech 'pm2 restart pawtropolis'
   ```

### SSH Connection Issues

Verify SSH config:
```bash
ssh pawtech 'echo "Connected"'
```

If this fails, check `~/.ssh/config` for the `pawtech` host entry.

### Deploy Script Fails

1. Check disk space on remote:
   ```bash
   ssh pawtech 'df -h'
   ```

2. Check for locked files:
   ```bash
   ssh pawtech 'lsof +D ~/pawtropolis-tech'
   ```

### Tests Fail During Deploy

The agent will ask you before proceeding. Common reasons:
- Flaky tests (usually safe to proceed)
- Actual bugs (fix before deploying)
- Missing environment variables

## Server Details

| Property | Value |
|----------|-------|
| SSH Alias | `pawtech` |
| Host | `3.209.223.216` |
| User | `ubuntu` |
| Path | `/home/ubuntu/pawtropolis-tech` |
| PM2 Process | `pawtropolis` |
| Health Port | `3002` |

## See Also

- [deployment-config.md](./deployment-config.md) - Environment setup
- [troubleshooting.md](./troubleshooting.md) - Common problems
- [.claude/agents/deploy-changes.md](../../.claude/agents/deploy-changes.md) - Agent configuration
