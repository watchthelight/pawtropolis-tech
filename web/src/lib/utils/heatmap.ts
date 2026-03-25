/** Full hour range for tooltip: "2:00 PM – 3:00 PM" */
export function formatHourRange(hour: number): string {
	const startH = hour % 12 || 12;
	const startAmPm = hour < 12 ? 'AM' : 'PM';
	const endHour = (hour + 1) % 24;
	const endH = endHour % 12 || 12;
	const endAmPm = endHour < 12 ? 'AM' : 'PM';
	return `${startH}:00 ${startAmPm} – ${endH}:00 ${endAmPm}`;
}

/** Full day name from ISO date string */
export function formatDayName(isoDate: string): string {
	return new Date(isoDate).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

/** Tooltip position constants — grid has 1 label col/row + 24 hours × 7 days */
export const TOTAL_COLS = 25; // 1 day-label column + 24 hour columns
export const TOTAL_ROWS = 8; // 1 hour-label row + 7 day rows
