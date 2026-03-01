// Seconds max ~year 2286 is <10B; milliseconds min ~year 2001 is >978B — no overlap
const SECONDS_THRESHOLD = 10_000_000_000;

export function normalizeTimestamp(
	value: string | number | null | undefined
): number | null {
	if (value == null) return null;

	if (typeof value === "string") {
		const ms = new Date(value).getTime();
		return Number.isNaN(ms) ? null : ms;
	}

	if (value < SECONDS_THRESHOLD) {
		return value * 1000;
	}

	return value;
}
