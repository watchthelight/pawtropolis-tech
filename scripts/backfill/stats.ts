/**
 * Pawtropolis Tech — scripts/backfill/stats.ts
 * WHAT: Heartbeat writer for backfill_stats row (read by web SSE).
 * WHY: Single-row table makes "what's happening right now" cheap to query.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import Database from "better-sqlite3";
import { statfsSync, statSync } from "node:fs";
import { resolve } from "node:path";

export class StatsEmitter {
  private db: Database.Database;
  private msgsAtStart = 0;
  private msgsAtLastTick = 0;
  private lastTickMs = Date.now();
  private timer: ReturnType<typeof setInterval> | null = null;
  private state: {
    started_at_s: number;
    channels_total: number;
    channels_completed: number;
    messages_total: number;
    reactions_total: number;
    current_channel_id: string | null;
    current_channel_name: string | null;
    process_state: "starting" | "running" | "paused" | "complete" | "error";
  };

  constructor(private dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.state = {
      started_at_s: Math.floor(Date.now() / 1000),
      channels_total: 0,
      channels_completed: 0,
      messages_total: 0,
      reactions_total: 0,
      current_channel_id: null,
      current_channel_name: null,
      process_state: "starting",
    };
  }

  setChannelsTotal(n: number): void {
    this.state.channels_total = n;
  }

  setCurrentChannel(id: string | null, name: string | null): void {
    this.state.current_channel_id = id;
    this.state.current_channel_name = name;
  }

  incChannelsCompleted(): void {
    this.state.channels_completed += 1;
  }

  incMessages(n: number): void {
    this.state.messages_total += n;
  }

  incReactions(n: number): void {
    this.state.reactions_total += n;
  }

  setState(s: "starting" | "running" | "paused" | "complete" | "error"): void {
    this.state.process_state = s;
  }

  start(intervalMs = 2000): void {
    if (this.timer) return;
    this.msgsAtStart = this.state.messages_total;
    this.msgsAtLastTick = this.state.messages_total;
    this.lastTickMs = Date.now();
    this.tick();
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.tick();
  }

  private getDiskInfo(): { used: number | null; total: number | null } {
    try {
      const fs = statfsSync(resolve(this.dbPath, ".."));
      const total = fs.blocks * fs.bsize;
      const free = fs.bavail * fs.bsize;
      return { used: total - free, total };
    } catch {
      return { used: null, total: null };
    }
  }

  private getDbSizeBytes(): number | null {
    try {
      return statSync(this.dbPath).size;
    } catch {
      return null;
    }
  }

  private tick(): void {
    const now = Date.now();
    const elapsedSec = Math.max(1, (now - this.lastTickMs) / 1000);
    const delta = this.state.messages_total - this.msgsAtLastTick;
    const rate = delta / elapsedSec;
    this.msgsAtLastTick = this.state.messages_total;
    this.lastTickMs = now;

    // ETA: extrapolate from average rate since start
    const totalElapsedSec = Math.max(1, now / 1000 - this.state.started_at_s);
    const avgRate = (this.state.messages_total - this.msgsAtStart) / totalElapsedSec;
    let eta: number | null = null;
    if (this.state.channels_total > 0 && this.state.channels_completed > 0 && avgRate > 0) {
      const remainingChannels = this.state.channels_total - this.state.channels_completed;
      const msgsPerChannel = this.state.messages_total / Math.max(1, this.state.channels_completed);
      eta = Math.floor((remainingChannels * msgsPerChannel) / avgRate);
    }

    const disk = this.getDiskInfo();
    const dbSize = this.getDbSizeBytes();

    try {
      this.db
        .prepare(
          `UPDATE backfill_stats SET
            started_at_s = @started_at_s,
            last_heartbeat_s = @hb,
            current_channel_id = @cid,
            current_channel_name = @cname,
            messages_total = @msgs,
            reactions_total = @reacts,
            channels_total = @ct,
            channels_completed = @cc,
            msgs_per_sec = @rate,
            eta_seconds = @eta,
            disk_used_bytes = @du,
            disk_total_bytes = @dt,
            process_state = @ps
           WHERE id = 1`
        )
        .run({
          started_at_s: this.state.started_at_s,
          hb: Math.floor(now / 1000),
          cid: this.state.current_channel_id,
          cname: this.state.current_channel_name,
          msgs: this.state.messages_total,
          reacts: this.state.reactions_total,
          ct: this.state.channels_total,
          cc: this.state.channels_completed,
          rate,
          eta,
          du: dbSize ?? disk.used,
          dt: disk.total,
          ps: this.state.process_state,
        });
    } catch {
      // table missing — migration not run yet
    }
  }

  close(): void {
    this.stop();
    this.db.close();
  }
}
