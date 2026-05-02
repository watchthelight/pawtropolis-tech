# Deployment hardening

`deploy.sh` is the single script that pushes a new build to the production EC2 instance. The May 2026 hardening pass added env-driven defaults, network timeouts, a remote deploy lock, an optional pre-deploy DB backup, and a dry-run preflight without changing any of the existing flag behaviors.

## Behavior preserved

Every prior invocation works the same way:

| Command | What it does |
|---------|--------------|
| `./deploy.sh` | full deploy: tests, build bot, build web, upload, install deps, run migrations, register slash commands, restart, health check |
| `./deploy.sh --bot` | build + upload + restart bot only |
| `./deploy.sh --web` | build + upload + restart dashboard only |
| `./deploy.sh --fast` | full deploy without running tests first |
| `./deploy.sh --logs` | full deploy, then tail recent logs |
| `./deploy.sh --restart` | no rebuild, just `pm2 startOrRestart` on remote |
| `./deploy.sh --status` | print remote `pm2 status` and exit |
| `./deploy.sh --graceful` | full deploy with SIGINT drain before restart |

## What is new

### Env overrides

Five host-shape constants are now overridable:

```
REMOTE_USER       (default: ubuntu)
REMOTE_HOST       (default: bash-ec2)
REMOTE_PATH       (default: /home/ubuntu/pawtropolis-tech)
PM2_PROCESS_BOT   (default: pawtropolis)
PM2_PROCESS_WEB   (default: pawtropolis-web)
```

Use cases: pointing at a staging box, alternate SSH alias, or a parallel PM2 process during a migration.

```bash
REMOTE_HOST=staging-box ./deploy.sh --bot
PM2_PROCESS_BOT=pawtropolis-canary ./deploy.sh --bot
```

### SSH/SCP timeouts

Every remote call goes through `ssh_remote` / `scp_remote` helpers that pass:

```
ConnectTimeout=15        fail fast on unreachable host
ServerAliveInterval=30   detect dropped connection during slow steps
ServerAliveCountMax=3    drop after 3 failed keepalives
BatchMode=yes            never prompt for password
```

A network blip during `npm ci` no longer hangs the script for hours.

### Deploy lock

Before any destructive remote action, the script does:

```
mkdir /tmp/pawtropolis-deploy.lock
```

`mkdir` is atomic on POSIX filesystems, so two parallel deploys race safely: the second one fails to create the directory and exits with a clear error. A `trap` removes the lock on script exit (success or failure).

If a previous deploy crashed without releasing the lock, the script tells you exactly how to clear it:

```
ERROR: another deploy is already in progress (lock at /tmp/pawtropolis-deploy.lock).
If you are sure no other deploy is running, ssh to bash-ec2 and remove the lock:
  ssh bash-ec2 rm -rf /tmp/pawtropolis-deploy.lock
```

Override the lock path with `DEPLOY_LOCK_DIR=/tmp/other-lock` if you ever need to.

### Optional pre-deploy DB backup

Set `BACKUP_BEFORE_DEPLOY=1` to copy the remote DB to a timestamped file inside `data/backups/` on the remote before the new tarball lands:

```bash
BACKUP_BEFORE_DEPLOY=1 ./deploy.sh
```

The backup runs after lock acquisition and before any tarball upload. Filename pattern: `data/data.db.<UTC_YYYYMMDD-HHMMSS>`. Default is off so existing scripts and CI jobs are unaffected.

### Dry run

```bash
./deploy.sh --dry-run
```

Prints the preflight summary (remote, processes, timeouts, lock path, backup setting) and exits before any remote command. Use it to confirm an env override worked, or to make sure you are about to deploy where you think you are.

### Preflight summary

Every non-dry-run invocation now prints a short summary so the operator can confirm the target before destructive actions begin:

```
Pawtropolis deploy preflight
  remote      : ubuntu@bash-ec2:/home/ubuntu/pawtropolis-tech
  bot process : pawtropolis
  web process : pawtropolis-web
  ssh timeout : ConnectTimeout=15s, KeepAlive=30s x3
  lock        : /tmp/pawtropolis-deploy.lock
  backup      : disabled
  dry-run     : false
```

## Rollback path

Today, a botched deploy is recovered manually:

1. SSH to remote.
2. `pm2 stop pawtropolis`.
3. If a backup was taken (`BACKUP_BEFORE_DEPLOY=1`), copy the relevant `data/backups/data.db.<ts>` back to `data/data.db`.
4. Check out the previous git tag in `~/pawtropolis-tech` (or restore from a previous tarball if `dist.bak` was kept).
5. `pm2 start ecosystem.config.cjs`.

A dedicated `--rollback` switch is tracked in TODO.md but not implemented in this pass; the user-facing pieces would be:

- Keep `dist.bak` (one slot) on remote during step 6.
- `--rollback` would copy `dist.bak` back, restore the most recent `data.db.<ts>`, and restart PM2.

When that work lands, document the new switch here.

## What is intentionally NOT changed

- The actual remote layout (one user, one path, two PM2 processes). The hardening is in the deploy *flow*, not the production architecture.
- The migration step (`scripts/migrate-remote.js`). Migrations remain the authoritative schema-evolution path; ensure helpers run on every startup.
- Tarball contents. Same files, same compression.
- Health check logic. Same five attempts, three-second delay, same matchers ("Bot ready" / "client_ready" / "Connected to Discord").

## Failure semantics

| Failure | Behavior |
|---------|----------|
| Lock held by other deploy | exit 1 with explicit clear-lock instructions |
| SSH connection refused | exit 1 within 15 seconds |
| Mid-deploy SSH timeout | exit 1; lock released by trap |
| `npm ci` fails on remote | exit 1; lock released by trap |
| Migration step fails | logs warning and continues (preserves prior behavior) |
| PM2 restart fails | next health check loop reports "unknown" status; script exits with the inconclusive warning but exit code 0 (preserves prior behavior) |

The migration-step warning vs hard-fail mismatch is intentional and predates this pass; revisit if you ever want to make migrations strict.
