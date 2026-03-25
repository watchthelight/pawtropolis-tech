/**
 * Pawtropolis Tech — tests/web/system.test.ts
 * WHAT: Unit tests for system health page helpers — alert status derivation, threshold colors.
 * WHY: Verify health alert processing and display logic for the Owner's system page.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect } from 'vitest';

// Duplicated because vitest can't resolve $lib/ aliases from SvelteKit modules.
// KEEP IN SYNC with web/src/lib/server/queries/system.ts (deriveAlertStatus)
function deriveAlertStatus(row: { resolved_at: number | null; acknowledged_at: number | null }): 'triggered' | 'acknowledged' | 'resolved' {
	if (row.resolved_at != null) return 'resolved';
	if (row.acknowledged_at != null) return 'acknowledged';
	return 'triggered';
}

// KEEP IN SYNC with web/src/routes/dashboard/system/+page.svelte (pingColor)
function pingColor(ms: number): string {
	if (ms < 100) return 'var(--status-success)';
	if (ms <= 500) return 'var(--status-warning)';
	return 'var(--status-danger)';
}

// KEEP IN SYNC with web/src/routes/dashboard/system/+page.svelte (percentColor)
function percentColor(pct: number, amberAt: number = 70, redAt: number = 90): string {
	if (pct < amberAt) return 'var(--status-success)';
	if (pct <= redAt) return 'var(--status-warning)';
	return 'var(--status-danger)';
}

describe('system health helpers', () => {
	describe('deriveAlertStatus', () => {
		it('returns triggered when neither acknowledged nor resolved', () => {
			expect(deriveAlertStatus({ resolved_at: null, acknowledged_at: null })).toBe('triggered');
		});

		it('returns acknowledged when acknowledged but not resolved', () => {
			expect(deriveAlertStatus({ resolved_at: null, acknowledged_at: 1700000000 })).toBe('acknowledged');
		});

		it('returns resolved when resolved_at is set', () => {
			expect(deriveAlertStatus({ resolved_at: 1700000000, acknowledged_at: null })).toBe('resolved');
		});

		it('returns resolved when both acknowledged and resolved (resolved takes priority)', () => {
			expect(deriveAlertStatus({ resolved_at: 1700000100, acknowledged_at: 1700000000 })).toBe('resolved');
		});
	});

	describe('pingColor (WS ping thresholds)', () => {
		it('returns green for ping under 100ms', () => {
			expect(pingColor(0)).toBe('var(--status-success)');
			expect(pingColor(50)).toBe('var(--status-success)');
			expect(pingColor(99)).toBe('var(--status-success)');
		});

		it('returns amber for ping 100-500ms', () => {
			expect(pingColor(100)).toBe('var(--status-warning)');
			expect(pingColor(300)).toBe('var(--status-warning)');
			expect(pingColor(500)).toBe('var(--status-warning)');
		});

		it('returns red for ping over 500ms', () => {
			expect(pingColor(501)).toBe('var(--status-danger)');
			expect(pingColor(1000)).toBe('var(--status-danger)');
		});
	});

	describe('percentColor (memory/disk thresholds)', () => {
		it('returns green under amber threshold', () => {
			expect(percentColor(0)).toBe('var(--status-success)');
			expect(percentColor(50)).toBe('var(--status-success)');
			expect(percentColor(69)).toBe('var(--status-success)');
		});

		it('returns amber between thresholds (default 70-90)', () => {
			expect(percentColor(70)).toBe('var(--status-warning)');
			expect(percentColor(80)).toBe('var(--status-warning)');
			expect(percentColor(90)).toBe('var(--status-warning)');
		});

		it('returns red above red threshold (default 90)', () => {
			expect(percentColor(91)).toBe('var(--status-danger)');
			expect(percentColor(100)).toBe('var(--status-danger)');
		});

		it('respects custom thresholds for disk (70/85)', () => {
			expect(percentColor(69, 70, 85)).toBe('var(--status-success)');
			expect(percentColor(70, 70, 85)).toBe('var(--status-warning)');
			expect(percentColor(85, 70, 85)).toBe('var(--status-warning)');
			expect(percentColor(86, 70, 85)).toBe('var(--status-danger)');
		});
	});
});
