/**
 * Pawtropolis Tech — scripts/backfill/rateLimiter.ts
 * WHAT: Token-bucket rate limiter for Discord REST calls during backfill.
 * WHY: discord.js handles 429s, but we throttle proactively to leave headroom
 *      for the live bot's command traffic and to avoid cloudflare bans.
 * MODEL:
 *  - Global bucket: 40 req/s sustained (Discord allows 50, we leave 10 for live)
 *  - Per-channel bucket: 4 req/s (Discord allows 5)
 *  - Adds jitter to prevent thundering herd
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

interface Bucket {
  tokens: number;
  lastRefill: number;
  capacity: number;
  refillPerSec: number;
}

function newBucket(capacity: number, refillPerSec: number): Bucket {
  return { tokens: capacity, lastRefill: Date.now(), capacity, refillPerSec };
}

function refill(b: Bucket): void {
  const now = Date.now();
  const elapsedSec = (now - b.lastRefill) / 1000;
  b.tokens = Math.min(b.capacity, b.tokens + elapsedSec * b.refillPerSec);
  b.lastRefill = now;
}

async function take(b: Bucket): Promise<void> {
  while (true) {
    refill(b);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return;
    }
    const waitMs = ((1 - b.tokens) / b.refillPerSec) * 1000 + Math.random() * 50;
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

export class RateLimiter {
  private global: Bucket;
  private channels: Map<string, Bucket> = new Map();
  private readonly perChannelCapacity: number;
  private readonly perChannelRefill: number;

  constructor(opts?: { globalRps?: number; perChannelRps?: number }) {
    const gr = opts?.globalRps ?? 40;
    this.global = newBucket(gr, gr);
    this.perChannelCapacity = opts?.perChannelRps ?? 4;
    this.perChannelRefill = opts?.perChannelRps ?? 4;
  }

  /** Acquire one token globally + one for the specified channel (if any). */
  async acquire(channelId?: string): Promise<void> {
    await take(this.global);
    if (channelId) {
      let b = this.channels.get(channelId);
      if (!b) {
        b = newBucket(this.perChannelCapacity, this.perChannelRefill);
        this.channels.set(channelId, b);
      }
      await take(b);
    }
  }
}
