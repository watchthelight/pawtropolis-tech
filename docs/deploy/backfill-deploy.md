# Message Archive + Backfill — Deploy Notes

End-to-end deploy of full-content message archive (humans + bots), reactor lists, and resumable backfill.

## What's shipping

- **migrations/075_message_archive.ts** — `messages_archive`, `message_reactions_archive`, `backfill_progress`, `backfill_stats`.
- **src/features/messageArchive.ts** + listeners in `src/index.ts` — live ingestion via `messageCreate / Update / Delete / ReactionAdd / Remove`.
- **scripts/backfill/run.ts** — paginates every channel + thread with token-bucket rate limiting.
- **ecosystem.config.cjs** — `pawtropolis-backfill` PM2 app (autorestart:false).
- **web/src/routes/dashboard/backfill** — owner-only SSE dashboard.

## On EC2 (`bash-ec2`)

```bash
ssh bash-ec2
cd /home/ubuntu/pawtropolis-tech
git fetch origin && git pull

# 1. Build bot + web
npm ci
npm run build
(cd web && npm ci && npm run build)

# 2. Run migration 075 (creates archive tables)
npx dotenvx run -- tsx scripts/migrate.ts

# 3. Restart bot to pick up new intents + listeners
pm2 restart pawtropolis

# 4. Verify live archive is writing
sleep 30
node -e "const db=require('better-sqlite3')('data/data.db',{readonly:true}); console.log(db.prepare('SELECT COUNT(*) c FROM messages_archive').get())"

# 5. Restart web for new /dashboard/backfill route
pm2 restart pawtropolis-web

# 6. Start backfill (one-shot, resumable)
pm2 start ecosystem.config.cjs --only pawtropolis-backfill
pm2 logs pawtropolis-backfill --lines 50
```

## Watch progress

- **Dashboard**: https://pawtropolis.tech/dashboard/backfill (owner only)
- **Logs**: `pm2 logs pawtropolis-backfill`
- **DB query**:
  ```bash
  node -e "const db=require('better-sqlite3')('data/data.db',{readonly:true}); console.log(db.prepare('SELECT status, COUNT(*) c FROM backfill_progress GROUP BY status').all())"
  ```

## Stop / resume

```bash
# Pause (SIGTERM — flushes buffers and saves cursor)
pm2 stop pawtropolis-backfill

# Resume from cursor
pm2 restart pawtropolis-backfill

# Or force-skip already-complete channels
DISCORD_TOKEN=... npx tsx scripts/backfill/run.ts --resume-only
```

## Tuning

In `scripts/backfill/run.ts`:
- `--channels=ID1,ID2` — limit to specific channels (debugging)
- `--skip-reactions` — much faster, metadata only
- `--resume-only` — only re-run channels not yet marked `complete`

Rate limits in `scripts/backfill/rateLimiter.ts`:
- Global: 40 req/s (Discord cap 50, leaves headroom for live bot)
- Per-channel: 4 req/s (Discord cap 5)

## Storage expectations

| Msgs backfilled | Disk |
|---|---|
| 5M | ~1.9 GB |
| 10M | ~3.8 GB |
| 20M | ~7.6 GB |

t3.large gp3 30GB is fine. Current DB ~4.8 GB; backfill takes total to ~10-12 GB worst case.

## Time expectations

- Messages only: 10M / 100 per page / 40 rps ≈ 70 min ideal, **~3-6 hr realistic**.
- Reactions (reactor lists): 35% of msgs × 2 emoji = 7M extra API calls. **~3-5 days realistic** under our rate limiter.
- `--skip-reactions` cuts total to hours instead of days.

## Caveats

- **No edit history pre-bot** — Discord API only exposes latest edit, not chain.
- **No reaction timestamps for backfilled rows** — API doesn't return when reactions occurred.
- **Removed reactions/messages before bot existed** — unrecoverable.
- **Discord CDN URLs in `attachments_json` expire** (~24h since 2023). Re-host if archival is required — out of scope for v1.

## Verify after completion

```bash
# Sanity totals
node -e "const db=require('better-sqlite3')('data/data.db',{readonly:true});
  console.log('messages:', db.prepare('SELECT COUNT(*) c FROM messages_archive').get());
  console.log('reactions:', db.prepare('SELECT COUNT(*) c FROM message_reactions_archive').get());
  console.log('channels complete:', db.prepare(\"SELECT COUNT(*) c FROM backfill_progress WHERE status='complete'\").get());"

# Stop PM2 app once complete (it should exit cleanly already)
pm2 delete pawtropolis-backfill
```
