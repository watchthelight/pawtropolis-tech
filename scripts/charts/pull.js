// Run on EC2: cd /home/ubuntu/pawtropolis-tech && node scripts/charts/pull.js > /tmp/chart-data.json
// Pulls all 20 chart datasets in one process. Reads ../data/data.db.
const Database = require("better-sqlite3");
const path = require("path");

const dbPath = process.env.DB_PATH || "data/data.db";
const guildId = process.env.GUILD_ID || "896070888594759740";
const db = new Database(dbPath, { readonly: true });
db.pragma("query_only = ON");

const nowS = Math.floor(Date.now() / 1000);
const DAY = 86400;

function q(sql, ...params) { return db.prepare(sql).all(...params); }
function q1(sql, ...params) { return db.prepare(sql).get(...params); }

const out = { generatedAt: nowS, guildId, nowISO: new Date(nowS * 1000).toISOString() };

// ── 1. member_count daily ─────────────────────────────────────────────────
out.memberCount = q(
  `SELECT date, member_count AS members, online_count AS online, boost_count AS boosts
   FROM guild_snapshot_log
   WHERE guild_id = ?
   ORDER BY date`, guildId
);

// ── 2. joins vs leaves daily (last 180d) ──────────────────────────────────
{
  const startS = nowS - 180 * DAY;
  const joins = q(
    `SELECT joined_at AS ts FROM user_activity
     WHERE guild_id = ? AND joined_at >= ? AND joined_at < ?`, guildId, startS, nowS
  );
  const leaves = q(
    `SELECT left_at AS ts FROM user_activity
     WHERE guild_id = ? AND left_at IS NOT NULL AND left_at >= ? AND left_at < ?`, guildId, startS, nowS
  );
  const buckets = new Map();
  function bump(ts, key) {
    const d = new Date(Number(ts) * 1000).toISOString().slice(0, 10);
    if (!buckets.has(d)) buckets.set(d, { date: d, joins: 0, leaves: 0 });
    buckets.get(d)[key]++;
  }
  for (const r of joins) bump(r.ts, "joins");
  for (const r of leaves) bump(r.ts, "leaves");
  out.joinsLeaves = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ── 3. cohort retention triangle ─────────────────────────────────────────
// For each cohort week (last 16 weeks), % of joiners who had any message
// within 1d, 7d, 14d, 28d of joining.
{
  const weeks = 16;
  const cohorts = [];
  for (let w = weeks; w >= 1; w--) {
    const weekStart = nowS - w * 7 * DAY;
    const weekEnd = weekStart + 7 * DAY;
    const users = q(
      `SELECT user_id, joined_at, first_message_at
       FROM user_activity
       WHERE guild_id = ? AND joined_at >= ? AND joined_at < ?`, guildId, weekStart, weekEnd
    );
    if (users.length === 0) continue;
    const buckets = [1, 7, 14, 28].map(days => {
      let messaged = 0;
      for (const u of users) {
        if (u.first_message_at != null && (u.first_message_at - u.joined_at) <= days * DAY) messaged++;
      }
      return { days, pct: 100 * messaged / users.length };
    });
    cohorts.push({
      weekStart: new Date(weekStart * 1000).toISOString().slice(0, 10),
      size: users.length,
      buckets
    });
  }
  out.cohorts = cohorts;
}

// ── 4. time-to-first-message distribution ─────────────────────────────────
{
  const rows = q(
    `SELECT (first_message_at - joined_at) AS delay
     FROM user_activity
     WHERE guild_id = ? AND first_message_at IS NOT NULL AND joined_at IS NOT NULL
       AND first_message_at >= joined_at AND joined_at >= ?`,
    guildId, nowS - 365 * DAY
  );
  out.timeToFirstMessage = rows.map(r => Number(r.delay));
  const ghosts = q1(
    `SELECT COUNT(*) AS c FROM user_activity
     WHERE guild_id = ? AND first_message_at IS NULL AND joined_at IS NOT NULL AND joined_at >= ?`,
    guildId, nowS - 365 * DAY
  );
  out.ghostCount = ghosts.c;
}

// ── 5. rapid join-leave categories per day ────────────────────────────────
{
  const startS = nowS - 60 * DAY;
  const rows = q(
    `SELECT joined_at, left_at FROM user_activity
     WHERE guild_id = ? AND joined_at >= ? AND joined_at < ?`, guildId, startS, nowS
  );
  const buckets = new Map();
  for (const r of rows) {
    const d = new Date(Number(r.joined_at) * 1000).toISOString().slice(0, 10);
    if (!buckets.has(d)) buckets.set(d, { date: d, stayed: 0, left24h: 0, left7d: 0, leftLater: 0 });
    const b = buckets.get(d);
    if (r.left_at == null) b.stayed++;
    else {
      const delta = r.left_at - r.joined_at;
      if (delta < DAY) b.left24h++;
      else if (delta < 7 * DAY) b.left7d++;
      else b.leftLater++;
    }
  }
  out.rapidJoinLeave = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ── 6. messages daily YoY (last 13 months) ────────────────────────────────
{
  const startS = nowS - 400 * DAY;
  const rows = q(
    `SELECT created_at_s / 86400 AS day, COUNT(*) AS c
     FROM message_activity
     WHERE guild_id = ? AND created_at_s >= ?
     GROUP BY day ORDER BY day`, guildId, startS
  );
  out.messagesYoY = rows.map(r => ({
    date: new Date(Number(r.day) * 86400 * 1000).toISOString().slice(0, 10),
    count: r.c
  }));
}

// ── 7. hour × day-of-week heatmap (last 90d) ─────────────────────────────
{
  const startS = nowS - 90 * DAY;
  // hour_bucket is unix-second aligned to the hour (e.g. 1764007200 → 2025-11-24 18:00 UTC).
  // hour-of-day = (hb % 86400) / 3600. DoW from Date.getUTCDay() (Sun=0..Sat=6).
  const rows = q(
    `SELECT hour_bucket, COUNT(*) AS c
     FROM message_activity
     WHERE guild_id = ? AND created_at_s >= ?
     GROUP BY hour_bucket`, guildId, startS
  );
  const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const r of rows) {
    const hb = Number(r.hour_bucket);
    const hour = Math.floor((hb % 86400) / 3600);
    const date = new Date(hb * 1000);
    let dow = date.getUTCDay();
    dow = (dow + 6) % 7; // Mon=0 ... Sun=6
    heat[dow][hour] += r.c;
  }
  out.hourDow = heat;
}

// ── 8. channel ranking top 15 (last 30d) ──────────────────────────────────
{
  const startS = nowS - 30 * DAY;
  out.channelRanking = q(
    `SELECT ma.channel_id AS channelId,
            COALESCE(cc.name, 'unknown-' || substr(ma.channel_id, -5)) AS name,
            COUNT(*) AS messages,
            COUNT(DISTINCT ma.user_id) AS users
     FROM message_activity ma
     LEFT JOIN channel_cache cc ON cc.guild_id = ma.guild_id AND cc.channel_id = ma.channel_id
     WHERE ma.guild_id = ? AND ma.created_at_s >= ?
     GROUP BY ma.channel_id
     ORDER BY messages DESC
     LIMIT 15`, guildId, startS
  );
}

// ── 9. communicator pyramid / Lorenz ──────────────────────────────────────
{
  const rows = q(
    `SELECT message_count AS c FROM user_message_counts
     WHERE guild_id = ? AND message_count > 0
     ORDER BY message_count ASC`, guildId
  );
  out.userMessageCounts = rows.map(r => r.c);
}

// ── 10. daily distinct communicators ──────────────────────────────────────
{
  const startS = nowS - 180 * DAY;
  out.distinctCommunicators = q(
    `SELECT created_at_s / 86400 AS day, COUNT(DISTINCT user_id) AS users
     FROM message_activity
     WHERE guild_id = ? AND created_at_s >= ?
     GROUP BY day ORDER BY day`, guildId, startS
  ).map(r => ({
    date: new Date(Number(r.day) * 86400 * 1000).toISOString().slice(0, 10),
    users: r.users
  }));
}

// ── 11. voice minutes per day (last 90d) ──────────────────────────────────
{
  const startS = nowS - 90 * DAY;
  const sessions = q(
    `SELECT joined_at_s, left_at_s FROM voice_session
     WHERE guild_id = ? AND joined_at_s >= ? AND joined_at_s < ?`, guildId, startS, nowS
  );
  const buckets = new Map();
  for (const s of sessions) {
    const start = Number(s.joined_at_s);
    const end = s.left_at_s != null ? Number(s.left_at_s) : nowS;
    // Split duration across days it spans
    let cursor = start;
    while (cursor < end) {
      const dayStart = cursor - (cursor % DAY);
      const dayEnd = dayStart + DAY;
      const seg = Math.min(end, dayEnd) - cursor;
      const d = new Date(dayStart * 1000).toISOString().slice(0, 10);
      buckets.set(d, (buckets.get(d) || 0) + seg / 60);
      cursor = dayEnd;
    }
  }
  out.voiceMinutesDaily = [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, minutes]) => ({ date, minutes: Math.round(minutes) }));
}

// ── 12. top voice channels treemap (last 30d) ─────────────────────────────
{
  const startS = nowS - 30 * DAY;
  out.voiceChannelTotals = q(
    `SELECT vs.channel_id AS channelId,
            COALESCE(cc.name, 'unknown-' || substr(vs.channel_id, -5)) AS name,
            SUM(CASE WHEN vs.left_at_s IS NOT NULL THEN vs.left_at_s - vs.joined_at_s ELSE ? - vs.joined_at_s END) / 60 AS minutes,
            COUNT(DISTINCT vs.user_id) AS users
     FROM voice_session vs
     LEFT JOIN channel_cache cc ON cc.guild_id = vs.guild_id AND cc.channel_id = vs.channel_id
     WHERE vs.guild_id = ? AND vs.joined_at_s >= ?
     GROUP BY vs.channel_id
     HAVING minutes > 0
     ORDER BY minutes DESC
     LIMIT 12`, nowS, guildId, startS
  );
}

// ── 13. voice session length distribution (last 60d, closed sessions) ─────
{
  const startS = nowS - 60 * DAY;
  const rows = q(
    `SELECT (left_at_s - joined_at_s) AS dur FROM voice_session
     WHERE guild_id = ? AND joined_at_s >= ? AND left_at_s IS NOT NULL`, guildId, startS
  );
  out.voiceSessionDurations = rows.map(r => Number(r.dur));
}

// ── 14. decisions per day stacked (last 90d) ──────────────────────────────
{
  const startS = nowS - 90 * DAY;
  const rows = q(
    `SELECT created_at_s / 86400 AS day, action, COUNT(*) AS c
     FROM action_log
     WHERE guild_id = ? AND created_at_s >= ?
       AND action IN ('approve','reject','perm_reject','kick')
     GROUP BY day, action
     ORDER BY day`, guildId, startS
  );
  const buckets = new Map();
  for (const r of rows) {
    const d = new Date(Number(r.day) * 86400 * 1000).toISOString().slice(0, 10);
    if (!buckets.has(d)) buckets.set(d, { date: d, approve: 0, reject: 0, perm_reject: 0, kick: 0 });
    buckets.get(d)[r.action] = r.c;
  }
  out.decisionsStacked = [...buckets.values()];
}

// ── 15. application funnel ────────────────────────────────────────────────
{
  out.applicationFunnel = q(
    `SELECT status, COUNT(*) AS c FROM application WHERE guild_id = ? GROUP BY status`, guildId
  );
}

// ── 16. mod workload ──────────────────────────────────────────────────────
{
  // Union of every actor ever in action_log + every mod ever in mod_metrics.
  // Counts come from action_log (canonical) so cached mod_metrics drift doesn't matter.
  const actionRows = q(
    `SELECT actor_id AS modId,
            SUM(CASE WHEN action = 'approve' THEN 1 ELSE 0 END) AS approve,
            SUM(CASE WHEN action = 'reject' THEN 1 ELSE 0 END) AS reject,
            SUM(CASE WHEN action = 'perm_reject' THEN 1 ELSE 0 END) AS permReject,
            SUM(CASE WHEN action = 'kick' THEN 1 ELSE 0 END) AS kick
     FROM action_log
     WHERE guild_id = ? AND action IN ('approve','reject','perm_reject','kick')
     GROUP BY actor_id`, guildId
  );
  const byMod = new Map();
  for (const r of actionRows) {
    byMod.set(r.modId, {
      modId: r.modId,
      approve: r.approve || 0,
      reject: r.reject || 0,
      permReject: r.permReject || 0,
      kick: r.kick || 0,
      p50S: null, p95S: null
    });
  }
  // Add any mods from mod_metrics that aren't already in (zero-review or pre-action_log)
  const metricRows = q(
    `SELECT moderator_id AS modId, total_accepts AS approve, total_rejects AS reject,
            total_kicks AS kick, p50_response_time_s AS p50S, p95_response_time_s AS p95S
     FROM mod_metrics WHERE guild_id = ?`, guildId
  );
  for (const m of metricRows) {
    const existing = byMod.get(m.modId);
    if (existing) {
      // Keep action_log counts (canonical), pull p50/p95 from mod_metrics
      existing.p50S = m.p50S;
      existing.p95S = m.p95S;
    } else {
      // Mod present in mod_metrics but no action_log entries — usually zero-review
      byMod.set(m.modId, {
        modId: m.modId,
        approve: m.approve || 0,
        reject: m.reject || 0,
        permReject: 0,
        kick: m.kick || 0,
        p50S: m.p50S, p95S: m.p95S
      });
    }
  }
  out.modWorkload = [...byMod.values()].sort((a, b) =>
    (b.approve + b.reject + b.permReject + b.kick) - (a.approve + a.reject + a.permReject + a.kick)
  );
  for (const m of out.modWorkload) {
    let row = q1(`SELECT display, username FROM user_names WHERE id = ?`, m.modId);
    if (!row) row = q1(`SELECT username FROM user_cache WHERE user_id = ?`, m.modId);
    m.name = row ? (row.display || row.username || m.modId.slice(-6)) : m.modId.slice(-6);
  }
}

// ── 17. modmail response time trend ───────────────────────────────────────
{
  const startS = nowS - 90 * DAY;
  // tickets with at least one to_user reply
  const rows = q(
    `SELECT mt.created_at AS opened,
            (SELECT MIN(strftime('%s', mm.created_at)) FROM modmail_message mm
             WHERE mm.ticket_id = mt.id AND mm.direction = 'to_user') AS firstReply
     FROM modmail_ticket mt
     WHERE mt.guild_id = ? AND strftime('%s', mt.created_at) >= ?`, guildId, String(startS)
  );
  const parsed = [];
  for (const r of rows) {
    if (!r.firstReply) continue;
    const opened = Math.floor(Date.parse(r.opened) / 1000);
    const reply = Number(r.firstReply);
    if (!Number.isFinite(opened) || !Number.isFinite(reply) || reply < opened) continue;
    parsed.push({
      date: new Date(opened * 1000).toISOString().slice(0, 10),
      delaySec: reply - opened
    });
  }
  // bucket by date with p50/p95
  const byDate = new Map();
  for (const r of parsed) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r.delaySec);
  }
  function pct(xs, p) {
    if (xs.length === 0) return null;
    const sorted = [...xs].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  }
  out.modmailResponse = [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, xs]) => ({ date, p50: pct(xs, 0.5), p95: pct(xs, 0.95), count: xs.length }));
}

// ── 18. flag timeline (last 120d) ─────────────────────────────────────────
{
  const startS = nowS - 120 * DAY;
  // nsfw_flags.flagged_at is ISO text. behavioral via user_activity.flagged_at is INT seconds.
  const nsfwRows = q(
    `SELECT strftime('%s', flagged_at) AS ts FROM nsfw_flags
     WHERE guild_id = ? AND strftime('%s', flagged_at) >= ?`, guildId, String(startS)
  );
  const behavRows = q(
    `SELECT flagged_at AS ts FROM user_activity
     WHERE guild_id = ? AND flagged_at IS NOT NULL AND flagged_at >= ?`, guildId, startS
  );
  const buckets = new Map();
  for (const r of nsfwRows) {
    const d = new Date(Number(r.ts) * 1000).toISOString().slice(0, 10);
    if (!buckets.has(d)) buckets.set(d, { date: d, nsfw: 0, behavioral: 0 });
    buckets.get(d).nsfw++;
  }
  for (const r of behavRows) {
    const d = new Date(Number(r.ts) * 1000).toISOString().slice(0, 10);
    if (!buckets.has(d)) buckets.set(d, { date: d, nsfw: 0, behavioral: 0 });
    buckets.get(d).behavioral++;
  }
  out.flagsTimeline = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ── 19. growth source breakdown (last 180d, by invite code) ───────────────
{
  const startS = nowS - 180 * DAY;
  // top codes
  const topCodes = q(
    `SELECT invite_code AS code, COUNT(*) AS c FROM invite_usage
     WHERE guild_id = ? AND joined_at_s >= ? AND invite_code IS NOT NULL
     GROUP BY invite_code ORDER BY c DESC LIMIT 8`, guildId, startS
  ).map(r => r.code);
  const topSet = new Set(topCodes);
  // per-week breakdown
  const rows = q(
    `SELECT (joined_at_s / 604800) AS week, invite_code AS code, COUNT(*) AS c
     FROM invite_usage
     WHERE guild_id = ? AND joined_at_s >= ?
     GROUP BY week, code
     ORDER BY week`, guildId, startS
  );
  const byWeek = new Map();
  for (const r of rows) {
    const weekStart = new Date(Number(r.week) * 604800 * 1000).toISOString().slice(0, 10);
    if (!byWeek.has(weekStart)) {
      const init = { week: weekStart, other: 0 };
      for (const c of topCodes) init[c] = 0;
      byWeek.set(weekStart, init);
    }
    const b = byWeek.get(weekStart);
    if (r.code == null) b.other += r.c;
    else if (topSet.has(r.code)) b[r.code] += r.c;
    else b.other += r.c;
  }
  out.growthSource = {
    codes: topCodes,
    weeks: [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week))
  };
}

// ── 20. inviter leaderboard with retention ────────────────────────────────
{
  const startS = nowS - 180 * DAY;
  // For each inviter: count invited, count of those who messaged (joined to user_activity)
  out.inviterRetention = q(
    `SELECT iu.inviter_id AS inviterId, COUNT(*) AS invited,
            COUNT(CASE WHEN ua.first_message_at IS NOT NULL THEN 1 END) AS messaged
     FROM invite_usage iu
     LEFT JOIN user_activity ua ON ua.guild_id = iu.guild_id AND ua.user_id = iu.user_id
     WHERE iu.guild_id = ? AND iu.joined_at_s >= ? AND iu.inviter_id IS NOT NULL
     GROUP BY iu.inviter_id
     HAVING invited >= 3
     ORDER BY invited DESC
     LIMIT 50`, guildId, startS
  );
  for (const r of out.inviterRetention) {
    const row = q1(`SELECT username FROM user_cache WHERE user_id = ?`, r.inviterId);
    r.name = row ? row.username : r.inviterId.slice(-6);
  }
}

process.stdout.write(JSON.stringify(out));
