/** Format a millisecond timestamp as relative time (e.g., "5m ago", "2h ago", "3d ago"). */
export function relativeTime(ms: number | null): string {
	if (!ms) return '';
	const diff = Date.now() - ms;
	const mins = Math.floor(diff / 60_000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

/** Format seconds as a human-readable duration (e.g., "5m", "2h 15m", "--"). */
export function formatDuration(seconds: number | null | undefined): string {
	if (seconds == null || seconds <= 0) return '--';
	const mins = Math.round(seconds / 60);
	if (mins < 60) return `${mins}m`;
	const h = Math.floor(mins / 60);
	const m = mins % 60;
	return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
