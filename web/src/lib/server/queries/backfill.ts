import { db } from "$lib/server/db";

export interface BackfillStats {
  startedAt: number | null;
  lastHeartbeat: number | null;
  currentChannelId: string | null;
  currentChannelName: string | null;
  messagesTotal: number;
  reactionsTotal: number;
  channelsTotal: number;
  channelsCompleted: number;
  msgsPerSec: number;
  etaSeconds: number | null;
  diskUsedBytes: number | null;
  diskTotalBytes: number | null;
  processState: "idle" | "starting" | "running" | "paused" | "complete" | "error";
  isStale: boolean;
}

export interface BackfillChannelRow {
  channelId: string;
  channelName: string;
  messagesFetched: number;
  reactionsFetched: number;
  status: string;
  oldestSeenTs: number | null;
  newestSeenTs: number | null;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
  lastError: string | null;
}

interface RawStatsRow {
  started_at_s: number | null;
  last_heartbeat_s: number | null;
  current_channel_id: string | null;
  current_channel_name: string | null;
  messages_total: number;
  reactions_total: number;
  channels_total: number;
  channels_completed: number;
  msgs_per_sec: number;
  eta_seconds: number | null;
  disk_used_bytes: number | null;
  disk_total_bytes: number | null;
  process_state: string;
}

const DEFAULT_STATS: BackfillStats = {
  startedAt: null,
  lastHeartbeat: null,
  currentChannelId: null,
  currentChannelName: null,
  messagesTotal: 0,
  reactionsTotal: 0,
  channelsTotal: 0,
  channelsCompleted: 0,
  msgsPerSec: 0,
  etaSeconds: null,
  diskUsedBytes: null,
  diskTotalBytes: null,
  processState: "idle",
  isStale: true,
};

export function getBackfillStats(): BackfillStats {
  try {
    const row = db().prepare(`SELECT * FROM backfill_stats WHERE id = 1`).get() as
      | RawStatsRow
      | undefined;
    if (!row) return DEFAULT_STATS;
    const now = Math.floor(Date.now() / 1000);
    const isStale = !row.last_heartbeat_s || now - row.last_heartbeat_s > 15;
    const declaredState = (row.process_state ?? "idle") as BackfillStats["processState"];
    const effectiveState = isStale && declaredState === "running" ? "paused" : declaredState;
    return {
      startedAt: row.started_at_s,
      lastHeartbeat: row.last_heartbeat_s,
      currentChannelId: row.current_channel_id,
      currentChannelName: row.current_channel_name,
      messagesTotal: row.messages_total,
      reactionsTotal: row.reactions_total,
      channelsTotal: row.channels_total,
      channelsCompleted: row.channels_completed,
      msgsPerSec: row.msgs_per_sec,
      etaSeconds: row.eta_seconds,
      diskUsedBytes: row.disk_used_bytes,
      diskTotalBytes: row.disk_total_bytes,
      processState: effectiveState,
      isStale,
    };
  } catch {
    return DEFAULT_STATS;
  }
}

interface RawChannelRow {
  channel_id: string;
  channel_name: string;
  messages_fetched: number;
  reactions_fetched: number;
  status: string;
  oldest_seen_ts: number | null;
  newest_seen_ts: number | null;
  started_at_s: number | null;
  completed_at_s: number | null;
  updated_at_s: number;
  last_error: string | null;
}

export function getBackfillChannels(): BackfillChannelRow[] {
  try {
    const rows = db()
      .prepare(
        `SELECT channel_id, channel_name, messages_fetched, reactions_fetched, status,
				        oldest_seen_ts, newest_seen_ts, started_at_s, completed_at_s, updated_at_s, last_error
				 FROM backfill_progress
				 ORDER BY
				   CASE status
				     WHEN 'running' THEN 0
				     WHEN 'error' THEN 1
				     WHEN 'pending' THEN 2
				     WHEN 'complete' THEN 3
				     ELSE 4
				   END,
				   updated_at_s DESC`
      )
      .all() as RawChannelRow[];
    return rows.map((r) => ({
      channelId: r.channel_id,
      channelName: r.channel_name,
      messagesFetched: r.messages_fetched,
      reactionsFetched: r.reactions_fetched,
      status: r.status,
      oldestSeenTs: r.oldest_seen_ts,
      newestSeenTs: r.newest_seen_ts,
      startedAt: r.started_at_s,
      completedAt: r.completed_at_s,
      updatedAt: r.updated_at_s,
      lastError: r.last_error,
    }));
  } catch {
    return [];
  }
}

// dbstat walks every page of the named tables, so the footprint is refreshed at most
// once per minute rather than on every page load and every stream tick.
const SIZE_CACHE_MS = 60_000;
let sizeCache: { at: number; sizeBytes: number | null } | null = null;

function archiveSizeBytes(): number | null {
  if (sizeCache && Date.now() - sizeCache.at < SIZE_CACHE_MS) return sizeCache.sizeBytes;
  let sizeBytes: number | null = null;
  try {
    const sz = db()
      .prepare(
        `SELECT SUM(pgsize) s FROM dbstat WHERE name IN ('messages_archive', 'message_reactions_archive')`
      )
      .get() as { s: number | null } | undefined;
    sizeBytes = sz?.s ?? null;
  } catch {
    /* dbstat extension may not be enabled */
  }
  sizeCache = { at: Date.now(), sizeBytes };
  return sizeBytes;
}

export function getArchiveCounts(): {
  messages: number;
  reactions: number;
  sizeBytes: number | null;
} {
  try {
    // The backfill process maintains running totals; COUNT(*) over the archive walked the
    // whole primary key on every load once the table held millions of rows.
    const totals = db()
      .prepare(`SELECT messages_total, reactions_total FROM backfill_stats WHERE id = 1`)
      .get() as { messages_total: number; reactions_total: number } | undefined;
    return {
      messages: totals?.messages_total ?? 0,
      reactions: totals?.reactions_total ?? 0,
      sizeBytes: archiveSizeBytes(),
    };
  } catch {
    return { messages: 0, reactions: 0, sizeBytes: null };
  }
}
