// Seconds max ~year 2286 is <10B; milliseconds min ~year 2001 is >978B — no overlap
const SECONDS_THRESHOLD = 10_000_000_000;

export function normalizeTimestamp(
	value: string | number | null | undefined
): number | null {
	if (value == null) return null;

	if (typeof value === "string") {
		// SQLite datetime('now') returns "YYYY-MM-DD HH:MM:SS" (UTC, no Z suffix).
		// new Date() parses space-separated formats as local time — normalize to ISO8601 UTC.
		const normalized = value.includes("T") ? value : value.replace(" ", "T") + "Z";
		const ms = new Date(normalized).getTime();
		return Number.isNaN(ms) ? null : ms;
	}

	if (value < SECONDS_THRESHOLD) {
		return value * 1000;
	}

	return value;
}
