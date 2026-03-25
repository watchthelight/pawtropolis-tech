# Incident Log

Production incidents and their resolutions for Pawtropolis Tech. Most recent first.

---

## INC-005: Duplicate Level Reward DMs - 2026-03-19

### Summary
Users receiving duplicate level-up reward DMs when Amaribot re-syncs level roles. UID 1424329992745127968 received identical Level 80 rewards on both March 16 and March 19. Systemic issue: 28 users affected, one user received Level 50 rewards 6 times.

### Reported By
UID 1424329992745127968 — duplicate Level 80 DM on 2026-03-19 (first sent 2026-03-16)

### Timeline
- **2025-12-18**: Earliest known duplicate (user 655469007784378408, level 50)
- **2026-01-08 to 2026-01-10**: Burst of 5 duplicate grants for single user — some only 20 minutes apart
- **2026-03-16 08:41**: UID 1424329992745127968 receives Level 80 rewards (correct)
- **2026-03-19 12:44**: Same user receives identical Level 80 reward DM (duplicate)
- **2026-03-19**: Bug reported, investigation begins

### Root Cause

**Two compounding issues:**

**Issue 1 (PRIMARY): 24-hour dedup window is insufficient.** The dedup in `levelRewards.ts:120-137` only checks `role_assignments` for grants within the last 24 hours. Level milestones are permanent one-time achievements, but when Amaribot re-syncs roles days later the dedup window has expired. The reported case: grants 3.17 days apart, far outside the 86,400s window.

**Issue 2 (SECONDARY): TOCTOU race condition.** The dedup query runs before `role_assignments` entries are written. Concurrent `guildMemberUpdate` events (e.g., after bot restart with stale member cache) can all pass the dedup before any write. Evidence: user received 3 duplicate grants on Jan 10 alone (17:26, 17:46, 22:38) — the 17:46 grant should have been blocked by the 17:26 entry.

**Contributing factor:** Every level role has 2 entries in `role_tiers` with different naming ("Legendary Fur" vs "Legendary Fur ‹‹ LVL 80 ››"). Same role_id/threshold. Setup script ran twice. Dashboard already needed a dedup fix for this (commit `dcd7b28`).

### Impact
- **28 users** with at least one duplicate level reward
- **~12 extra DMs** across 7 user+level combinations
- **Worst case:** 6 grants for same Level 50 milestone (5 duplicates)
- Confusing duplicate messages, potential double-granting of consumable token roles

### Recommended Fix
1. **Remove time constraint from dedup** — check for ANY previous grant ever, not just 24h
2. **Fix race condition** — write dedup marker before granting, or add `level_rewards_granted` table with UNIQUE constraint on `(guild_id, user_id, level)`
3. **Clean up 13 duplicate `role_tiers` entries**

### Severity
**Medium** — No security impact. User-facing annoyance and growing (28 users affected).

### Lessons Learned
1. Dedup windows must match the lifecycle of the thing being deduplicated — permanent achievements need permanent dedup
2. Time-based dedup is fragile for event-driven systems where re-triggers happen at arbitrary intervals
3. Setup scripts should be idempotent

### Resolution

**Status: Resolved** as of 2026-03-25.

Migration 057 deployed the `level_reward_granted` table with a `UNIQUE(guild_id, user_id, level)` constraint. This provides schema-level enforcement that makes it impossible to grant the same level's rewards twice, regardless of timing or concurrency.

The grant logic now uses `INSERT OR IGNORE` into `level_reward_granted` before processing rewards. If the row already exists (duplicate), the insert silently fails and no rewards are granted. This eliminates the TOCTOU race condition from the old approach — the check and the write are the same atomic operation.

Migration 057 also backfills all historical grants from the `role_assignments` table, covering the 150+ unprotected pre-fix grants that occurred between December 2025 and March 2026. The 13 duplicate `role_tiers` entries were cleaned up separately (migration 055).

---

## INC-004: Memory Pressure Causing Command Failures - 2026-01-19

### Summary
Discord slash commands were failing intermittently, requiring users to retry commands 3-5 times before they would work. Root cause was memory pressure on the t3a.small instance (918MB RAM) with no swap configured, causing the Node.js process to enter uninterruptible sleep (D state) during memory contention.

### Timeline
- **~21:00 UTC**: User reports commands failing intermittently ("I have to rerun every command like 5 times")
- **21:09 UTC**: `/listopen` command logged with "Unknown interaction" error (code 10062) after only 144ms
- **21:11 UTC**: Investigation reveals bot process in `D` state (uninterruptible sleep)
- **21:11 UTC**: Memory check shows only 92MB free, 0 swap
- **21:11 UTC**: Orphaned `commands.js` processes killed
- **21:12 UTC**: PM2 restart issued to clear stuck state
- **21:12 UTC**: 2GB swap file created and enabled
- **21:12 UTC**: Bot process now in `R` state (running), commands working

### Root Cause
The EC2 instance (t3a.small) has only 918MB of RAM. The bot uses ~200MB when loaded, leaving limited headroom for:
- Operating system operations
- Garbage collection spikes
- Concurrent database queries
- Discord.js caching

With **no swap configured**, when memory pressure occurred:
1. The kernel couldn't page out inactive memory
2. The Node.js process entered `D` state waiting for memory/I/O
3. Discord interactions timed out (3-second SLA) while the process was blocked
4. Discord reported "Unknown interaction" (error 10062) because the bot couldn't respond in time

### Why Commands Worked "Sometimes"
The failures were intermittent because:
- Memory pressure is transient (depends on concurrent operations)
- Some commands executed during low-pressure windows
- The 3-second Discord timeout is tight - even brief D-state periods cause failures

### Impact
- **User Experience**: Commands unreliable, frustrating retry behavior
- **Operational**: No data loss, but degraded service quality
- **Duration**: Unknown start time, ~10-15 minutes of investigation/resolution

### Resolution
1. **Immediate**: Restarted bot via PM2 to clear stuck process state
2. **Permanent**: Created 2GB swap file:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Memory Status Before/After
| Metric | Before | After |
|--------|--------|-------|
| Free RAM | 92MB | 207MB |
| Swap | 0MB | 2048MB |
| Process State | D (blocked) | R (running) |

### Preventive Measures Implemented
1. **Swap enabled**: 2GB swap file configured and persisted in `/etc/fstab`
2. **Orphan cleanup**: Killed leftover `commands.js` processes consuming memory

### Preventive Measures Needed
1. **Memory monitoring**: Add opshealth alert for low available memory (<100MB)
2. **Instance upgrade consideration**: t3a.small may be undersized long-term
3. **Process leak detection**: Monitor for orphaned child processes

### Lessons Learned
1. **Always configure swap** on small instances - even 1-2GB prevents hard failures
2. **Process state matters**: `D` state in `ps` output indicates I/O blocking issues
3. **918MB is marginal** for a Node.js Discord bot with caching and monitoring
4. **Intermittent failures** often indicate resource contention, not code bugs
5. **Discord's 3-second SLA** is unforgiving - any process blocking causes timeouts

### Related Issues
- **Voice tracking bug** (same session): Channel switches weren't tracked - fixed separately
- **INC-003** (same day): Disk space incident may have contributed to memory pressure via buffer cache starvation

---

## INC-003: Critical Disk Space Outage - 2026-01-19

### Summary
Production server became completely unresponsive due to disk space exhaustion (92% full, 519MB free on 6.7GB volume). Bot was offline for approximately 1 hour. Resolution required EC2 instance stop/start via AWS CLI and EBS volume expansion from 8GB to 32GB.

### Timeline
- **~11:10 UTC**: Bot goes offline (exact time unknown - no logs due to disk full)
- **~11:11 UTC**: Entropy reports bot is down in Discord
- **11:18 UTC**: Disk Space Critical alert posted to logging channel (92% usage, 519.5MB free)
- **11:25 UTC**: Bash attempts SSH connection - timeout, server unresponsive
- **11:28 UTC**: Multiple SSH retry attempts fail
- **12:20 UTC**: AWS CLI used to identify instance in us-east-1 region
- **12:20 UTC**: `aws ec2 reboot-instances` command sent - no effect
- **12:22 UTC**: `aws ec2 stop-instances --force` initiated
- **12:28 UTC**: Instance reached stopped state after extended stopping period
- **12:28 UTC**: User expanded EBS volume from 8GB to 32GB via AWS Console
- **12:28 UTC**: `aws ec2 start-instances` initiated
- **12:29 UTC**: Instance reached running state
- **12:29 UTC**: SSH connection successful, filesystem auto-extended to 30GB
- **12:29 UTC**: Disk usage now 21% (24GB free)
- **12:30 UTC**: PM2 restarted, bot online
- **12:30 UTC**: Slash commands re-registered (new `/attendance` command deployed)
- **~12:30 UTC**: Full service restored

### Root Cause
The EC2 instance was provisioned with only 6.7GB (8GB EBS volume minus filesystem overhead) of disk space. Over time, the following consumed available space:

1. **PM2 logs** - Accumulated application logs
2. **systemd journal** - System logs
3. **Database growth** - SQLite database and backups
4. **apt cache** - Package manager cache

The Disk Space Monitor feature (added in v5.1.0) correctly detected the critical state at 92% and posted an alert, but by then the server was already too full to accept SSH connections or function properly.

### Why SSH Failed
When a Linux server runs critically low on disk space:
- SSH daemon cannot write to `/var/log` or create session files
- New processes cannot be spawned
- The kernel may kill processes to free memory
- The system becomes effectively frozen

### Impact
- **Downtime**: ~1 hour of complete bot unavailability
- **User Impact**:
  - Gate applications could not be processed
  - Modmail unavailable
  - Event tracking interrupted (no active events at the time)
  - Security audits could not run
- **Data Loss**: None - SQLite database preserved

### Resolution
1. **Immediate**: Used AWS CLI to stop/start instance (reboot was ineffective)
2. **Capacity**: Expanded EBS volume from 8GB to 32GB
3. **Filesystem**: Ubuntu auto-extended root partition to use new space on boot
4. **Cleanup**: Flushed PM2 logs with `pm2 flush`
5. **Deployment**: Completed pending deployment of `/attendance` command

### AWS CLI Commands Used
```bash
# Find instance (was in us-east-1, not default us-east-2)
aws ec2 describe-instances --region us-east-1 \
  --query 'Reservations[*].Instances[*].[InstanceId,State.Name,PublicIpAddress]'

# Reboot attempt (ineffective when disk full)
aws ec2 reboot-instances --instance-ids i-0b5c5db57b50ff74b --region us-east-1

# Force stop
aws ec2 stop-instances --instance-ids i-0b5c5db57b50ff74b --region us-east-1 --force

# Wait for stopped
aws ec2 wait instance-stopped --instance-ids i-0b5c5db57b50ff74b --region us-east-1

# Start
aws ec2 start-instances --instance-ids i-0b5c5db57b50ff74b --region us-east-1

# Wait for running
aws ec2 wait instance-running --instance-ids i-0b5c5db57b50ff74b --region us-east-1
```

### Post-Incident Disk Status
| Before | After |
|--------|-------|
| 6.7GB total | 30GB total |
| 92% used | 21% used |
| 519MB free | 24GB free |

### Preventive Measures Implemented
1. **Increased disk capacity**: 8GB → 32GB EBS volume (~$2.40/month additional cost)
2. **PM2 logs flushed**: Immediate cleanup performed

### Preventive Measures Needed
1. **Earlier warning threshold**: Change disk monitor from 80%/90% to 70%/80%
2. **Automated log rotation**: Configure PM2 and journald to auto-rotate logs
3. **Proactive cleanup**: Add scheduled task to clean old backups
4. **Runbook**: Document AWS CLI recovery procedure for future incidents

### Lessons Learned
1. **8GB is not enough** for a production Discord bot with logging, monitoring, and database
2. **Disk space alerts need earlier thresholds** - by 92%, recovery is already difficult
3. **AWS CLI access is critical** - when SSH fails, AWS console/CLI is the only way in
4. **Instance region matters** - pawtech is in us-east-1, not the default us-east-2
5. **Reboot doesn't help** when disk is full - stop/start is required
6. **EBS volumes can be expanded online** but filesystem extension happens on reboot

### Server Details
- **Instance ID**: i-0b5c5db57b50ff74b
- **Region**: us-east-1
- **Instance Type**: t3a.small
- **Public IP**: 34.193.75.138 (Elastic IP)
- **EBS Volume**: vol-05bbabd84993a6241 (now 32GB gp3)

---

## INC-002: Community Apps Role with Administrator Permission - 2026-01-11

### Summary
The "Community Apps" role (ID: 896070888749940774) had full Administrator permission, giving 26 members unrestricted server access. Detected by automated security audit (CRIT-006) and resolved within ~1 minute.

### Timeline
- **Unknown**: Administrator permission added to Community Apps role
- **2026-01-11 ~09:40 UTC**: CRIT-006 alert generated by `/audit security`
- **2026-01-11 09:40 UTC**: Bash posts alert in Discord
- **2026-01-11 09:41 UTC**: Entropy questions the permission and disables Administrator
- **2026-01-11 09:41 UTC**: Resolution confirmed

### Root Cause
The "Community Apps" role, intended for bot users and applications, was granted full Administrator permission instead of specific required permissions. This is a common anti-pattern where Administrator is used as a quick fix for bot permission issues.

Administrator permission is critical because it:
- Bypasses ALL permission checks in Discord
- Grants unrestricted server access to all role members
- Cannot be limited by channel-level permission overwrites

### Impact
- **Security**: 26 accounts had full server control
- **Actual Damage**: None detected - quick resolution prevented exploitation
- **Exposure Window**: Unknown (Discord audit logs may reveal when Admin was added)

### Resolution
1. Entropy removed Administrator permission from Community Apps role
2. Role now has appropriate permissions: ManageChannels, ManageRoles, ModerateMembers

### Preventive Measures
- Automated security audits (`/audit security`) already in place and functioning
- CRIT-### alerts generated for Administrator on non-bot roles
- Consider adding real-time monitoring for dangerous permission grants

### Lessons Learned
- Automated security audits work - caught misconfiguration before exploitation
- Quick response (~1 minute) is critical for security incidents
- Bot permission issues should be solved with specific permissions, not Administrator
- The "Community Apps" role should be reviewed to ensure all 26 members are legitimate bots

---

## INC-001: AWS Cost Anomaly (+1400%) - 2026-01-02

### Summary
Monthly AWS EC2 costs spiked from ~$6/month to ~$71/month (+1400%) due to an oversized instance type.

### Timeline
- **2025-10-21**: pawtech instance launched as c7i-flex.large ($0.085/hr)
- **2025-12-01 to 2025-12-31**: Instance ran full month, incurring $63.08
- **2026-01-02 00:37 UTC**: Instance manually stopped
- **2026-01-02 00:45 UTC**: Investigation began
- **2026-01-02 00:55 UTC**: Resolution complete

### Root Cause
The production server was running on a `c7i-flex.large` instance ($63/month) when a much smaller instance would suffice for a Discord bot workload.

Additionally, two idle instances were discovered:
- `entropy.root` (t4g.small) - running but empty, ~$12.50/month wasted
- `watchthelight` (t4g.micro) - running, ~$6.25/month

### Impact
- **Financial**: ~$57/month excess spend
- **Operational**: None - bot was functioning normally

### Resolution
1. Terminated idle instances (`entropy.root`, `watchthelight`)
2. Changed `pawtech` instance type from `c7i-flex.large` to `t3a.small`
3. Restarted instance and verified bot operation
4. Removed bot from 6 unauthorized guilds (keeping only Pawtropolis)
5. Added auto-leave logic to prevent joining unauthorized servers

### Cost Impact
| Before | After | Monthly Savings |
|--------|-------|-----------------|
| ~$71/mo | ~$14/mo | ~$57/mo (80%) |

### Preventive Measures
- Added `guildCreate` handler to auto-leave unauthorized servers
- Bot now only operates in guild ID `896070888594759740` (Pawtropolis)

### Lessons Learned
- Regularly audit AWS instances for right-sizing opportunities
- Monitor for idle/orphaned resources
- Implement guild allowlisting for single-server bots
