/**
 * Two-tier cache for SvelteKit server load functions.
 *
 * L1: in-process LRU (sub-ms hits, dies with the Node process).
 * L2: optional Valkey/Redis (survives PM2 restarts; shared with the bot
 *     process so cron-warmed precomputed payloads — e.g. quality leaderboards
 *     — are read warm by the web).
 *
 * Backend selection via env:
 *   CACHE_BACKEND=memory   → L1 only (default; dev-friendly, zero deps)
 *   CACHE_BACKEND=valkey   → L1 + L2 over Valkey/Redis at CACHE_URL
 *                            (default redis://127.0.0.1:6379)
 *
 * `ioredis` is a dynamic import — environments that don't request the
 * valkey backend never load it.
 */

const MAX_ENTRIES = 200;

type Entry<T> = { value: T; expiresAt: number };

const memStore = new Map<string, Entry<unknown>>();
const pending = new Map<string, Promise<unknown>>();

function evictIfFull() {
  if (memStore.size < MAX_ENTRIES) return;
  const oldest = memStore.keys().next().value;
  if (oldest !== undefined) memStore.delete(oldest);
}

// ─── Optional Valkey/Redis client (lazy) ─────────────────────────────────

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "PX", ttl: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

let redisClient: RedisLike | null | undefined;
let redisInitFailed = false;

async function getRedis(): Promise<RedisLike | null> {
  if (redisClient !== undefined) return redisClient;
  if (redisInitFailed) return null;
  if (process.env.CACHE_BACKEND !== "valkey" && process.env.CACHE_BACKEND !== "redis") {
    redisClient = null;
    return null;
  }
  try {
    const mod = await import("ioredis");
    // ioredis exports a default class; the constructor accepts a URL.
    const Redis = (mod as unknown as { default: new (url: string) => RedisLike }).default;
    const url = process.env.CACHE_URL ?? "redis://127.0.0.1:6379";
    redisClient = new Redis(url);
    return redisClient;
  } catch (err) {
    console.warn("[cache] valkey backend requested but ioredis unavailable — running L1-only", err);
    redisInitFailed = true;
    redisClient = null;
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────

export async function cached<T>(
  key: string,
  ttlMs: number,
  compute: () => T | Promise<T>
): Promise<T> {
  const now = Date.now();

  // L1
  const hit = memStore.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > now) return hit.value;

  // In-flight dedupe (per-process)
  const inFlight = pending.get(key) as Promise<T> | undefined;
  if (inFlight) return inFlight;

  const work = (async (): Promise<T> => {
    // L2
    const redis = await getRedis();
    if (redis) {
      try {
        const raw = await redis.get(key);
        if (raw != null) {
          const parsed = JSON.parse(raw) as T;
          // Promote to L1 with a shorter TTL — Valkey is the durable copy.
          memStore.delete(key);
          evictIfFull();
          memStore.set(key, { value: parsed, expiresAt: Date.now() + Math.min(ttlMs, 60_000) });
          return parsed;
        }
      } catch (err) {
        console.warn("[cache] valkey read failed for", key, err);
      }
    }

    // Compute
    const value = await compute();

    // Write-through both tiers
    memStore.delete(key);
    evictIfFull();
    memStore.set(key, { value, expiresAt: Date.now() + ttlMs });

    if (redis) {
      try {
        await redis.set(key, JSON.stringify(value), "PX", ttlMs);
      } catch (err) {
        console.warn("[cache] valkey write failed for", key, err);
      }
    }
    return value;
  })().finally(() => {
    pending.delete(key);
  });

  pending.set(key, work);
  return work;
}

export function cacheKey(parts: (string | number | null | undefined)[]): string {
  return parts.map((p) => (p == null ? "" : String(p))).join(":");
}

export const CACHE_TTL = {
  short: 30_000,
  medium: 60_000,
  long: 300_000,
  veryLong: 30 * 60_000,
} as const;

export const CACHE_HEADERS = {
  default: "private, max-age=60, stale-while-revalidate=300",
} as const;

/**
 * Best-effort invalidation: drops L1 + L2 for the key. Use from mutation
 * handlers so other tabs hitting the cached path see fresh data on next read.
 */
export async function invalidate(key: string): Promise<void> {
  memStore.delete(key);
  const redis = await getRedis();
  if (redis) {
    try {
      await redis.del(key);
    } catch (err) {
      console.warn("[cache] valkey del failed for", key, err);
    }
  }
}
