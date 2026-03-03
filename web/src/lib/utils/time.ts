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
