import { db } from '$lib/server/db';

export interface HealthAlertRow {
	id: number;
	alertType: string;
	severity: string;
	triggeredAt: number;
	lastSeenAt: number;
	acknowledgedBy: string | null;
	acknowledgedAt: number | null;
	resolvedBy: string | null;
	resolvedAt: number | null;
	meta: Record<string, unknown> | null;
	/** Derived: 'triggered' | 'acknowledged' | 'resolved' */
	status: 'triggered' | 'acknowledged' | 'resolved';
}

interface RawAlertRow {
	id: number;
	alert_type: string;
	severity: string;
	triggered_at: number;
	last_seen_at: number;
	acknowledged_by: string | null;
	acknowledged_at: number | null;
	resolved_by: string | null;
	resolved_at: number | null;
	meta: string | null;
}

/** Derive alert status from columns */
export function deriveAlertStatus(row: { resolved_at: number | null; acknowledged_at: number | null }): 'triggered' | 'acknowledged' | 'resolved' {
	if (row.resolved_at != null) return 'resolved';
	if (row.acknowledged_at != null) return 'acknowledged';
	return 'triggered';
}

function mapAlertRow(row: RawAlertRow): HealthAlertRow {
	let meta: Record<string, unknown> | null = null;
	if (row.meta) {
		try { meta = JSON.parse(row.meta); } catch { /* invalid JSON */ }
	}
	return {
		id: row.id,
		alertType: row.alert_type,
		severity: row.severity,
		triggeredAt: row.triggered_at * 1000,
		lastSeenAt: row.last_seen_at * 1000,
		acknowledgedBy: row.acknowledged_by,
		acknowledgedAt: row.acknowledged_at ? row.acknowledged_at * 1000 : null,
		resolvedBy: row.resolved_by,
		resolvedAt: row.resolved_at ? row.resolved_at * 1000 : null,
		meta,
		status: deriveAlertStatus(row),
	};
}

/** Fetch recent health alerts — system-wide table, no guild_id filter */
export function getRecentHealthAlerts(limit: number = 20): HealthAlertRow[] {
	const rows = db().prepare(
		`SELECT id, alert_type, severity, triggered_at, last_seen_at,
		        acknowledged_by, acknowledged_at, resolved_by, resolved_at, meta
		 FROM health_alerts
		 ORDER BY triggered_at DESC
		 LIMIT ?`
	).all(limit) as RawAlertRow[];

	return rows.map(mapAlertRow);
}
