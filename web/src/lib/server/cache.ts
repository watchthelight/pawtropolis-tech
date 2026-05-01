// Tiny in-memory TTL cache for SvelteKit server load functions.
// Survives across requests within a single Node process (PM2 fork mode = 1 process).
// Repeated window-toggle clicks return the cached payload instantly.

const DEFAULT_TTL_MS = 60_000;
const MAX_ENTRIES = 200;

type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();
const pending = new Map<string, Promise<unknown>>();

function evictIfFull() {
	if (store.size < MAX_ENTRIES) return;
	const oldest = store.keys().next().value;
	if (oldest !== undefined) store.delete(oldest);
}

export async function cached<T>(key: string, ttlMs: number, compute: () => T | Promise<T>): Promise<T> {
	const now = Date.now();
	const hit = store.get(key) as Entry<T> | undefined;
	if (hit && hit.expiresAt > now) return hit.value;

	const inFlight = pending.get(key) as Promise<T> | undefined;
	if (inFlight) return inFlight;

	const work = Promise.resolve()
		.then(compute)
		.then((value) => {
			store.delete(key);
			evictIfFull();
			store.set(key, { value, expiresAt: Date.now() + ttlMs });
			return value;
		})
		.finally(() => {
			pending.delete(key);
		});

	pending.set(key, work);
	return work;
}

export function cacheKey(parts: (string | number | null | undefined)[]): string {
	return parts.map((p) => (p == null ? '' : String(p))).join(':');
}

export const CACHE_TTL = {
	short: 30_000,
	medium: 60_000,
	long: 300_000,
	veryLong: 30 * 60_000
} as const;

export const CACHE_HEADERS = {
	// Browser + SvelteKit data cache: instant on rapid window toggles, refresh in background after 60s.
	default: 'private, max-age=60, stale-while-revalidate=300'
} as const;
