<script lang="ts">
	import type { AvatarScanDetail, ScanScores } from '$lib/server/queries/reviews';
	import { getBotOnline } from '$lib/stores/bot-status.svelte';
	import { invalidateAll } from '$app/navigation';
	import { AlertTriangle, Shield, Sparkles, Loader2 } from 'lucide-svelte';

	let { appId, scan, scanScores, riskScore }: {
		appId: string;
		scan: AvatarScanDetail | null;
		scanScores: ScanScores | null;
		riskScore: number;
	} = $props();

	let scanningNsfw = $state(false);
	let scanningAi = $state(false);
	let scanError = $state<string | null>(null);

	const ALERT_THRESHOLD = 60;

	// Derive scores from data
	let avatarNsfw = $derived(scanScores?.avatarNsfwPct ?? riskScore);
	let bannerNsfw = $derived(scanScores?.bannerNsfwPct ?? null);
	let avatarAi = $derived(scanScores?.avatarAiPct ?? null);
	let bannerAi = $derived(scanScores?.bannerAiPct ?? null);

	let hasAnyScan = $derived(scan !== null || scanScores !== null);

	// Alert: any score over threshold
	let alerts = $derived.by(() => {
		const items: string[] = [];
		if (avatarNsfw >= ALERT_THRESHOLD) items.push(`Avatar NSFW ${avatarNsfw}%`);
		if (bannerNsfw !== null && bannerNsfw >= ALERT_THRESHOLD) items.push(`Banner NSFW ${bannerNsfw}%`);
		if (avatarAi !== null && avatarAi >= ALERT_THRESHOLD) items.push(`Avatar AI ${avatarAi}%`);
		if (bannerAi !== null && bannerAi >= ALERT_THRESHOLD) items.push(`Banner AI ${bannerAi}%`);
		return items;
	});

	function scoreColor(score: number | null): string {
		if (score === null) return 'var(--text-muted)';
		if (score >= 60) return 'var(--status-danger)';
		if (score >= 30) return 'var(--status-warning)';
		return 'var(--status-success)';
	}

	function scoreLabel(score: number | null, type: 'nsfw' | 'ai'): string {
		if (score === null) return '—';
		return `${score}%`;
	}

	async function scanNsfw() {
		scanningNsfw = true;
		scanError = null;
		try {
			const res = await fetch(`/api/scan/${appId}/nsfw`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ appId })
			});
			const contentType = res.headers.get('content-type') ?? '';
			if (!contentType.includes('application/json')) {
				throw new Error(`Bot API returned non-JSON (HTTP ${res.status})`);
			}
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'Scan failed');
			await invalidateAll();
		} catch (err) {
			scanError = err instanceof Error ? err.message : 'NSFW scan failed';
		} finally {
			scanningNsfw = false;
		}
	}

	async function scanAi() {
		scanningAi = true;
		scanError = null;
		try {
			const res = await fetch(`/api/scan/${appId}/ai`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ appId })
			});
			const contentType = res.headers.get('content-type') ?? '';
			if (!contentType.includes('application/json')) {
				throw new Error(`Bot API returned non-JSON (HTTP ${res.status})`);
			}
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'Scan failed');
			await invalidateAll();
		} catch (err) {
			scanError = err instanceof Error ? err.message : 'AI scan failed';
		} finally {
			scanningAi = false;
		}
	}
</script>

<div class="scan-panel">
	{#if alerts.length > 0}
		<div class="scan-alert">
			<AlertTriangle size={14} />
			<span>{alerts.join(' · ')} — exceeds {ALERT_THRESHOLD}% review threshold</span>
		</div>
	{/if}

	<div class="score-grid">
		<div class="score-cell" class:score-danger={avatarNsfw >= ALERT_THRESHOLD}>
			<span class="score-label">Avatar NSFW</span>
			<span class="score-value" style:color={scoreColor(avatarNsfw)}>{scoreLabel(avatarNsfw, 'nsfw')}</span>
			{#if scan?.reason && scan.reason !== 'none'}
				<span class="score-reason">{scan.reason}</span>
			{/if}
		</div>

		<div class="score-cell" class:score-danger={bannerNsfw !== null && bannerNsfw >= ALERT_THRESHOLD}>
			<span class="score-label">Banner NSFW</span>
			<span class="score-value" style:color={scoreColor(bannerNsfw)}>{scoreLabel(bannerNsfw, 'nsfw')}</span>
			{#if scanScores?.bannerReason && scanScores.bannerReason !== 'none'}
				<span class="score-reason">{scanScores.bannerReason}</span>
			{:else if bannerNsfw === null}
				<span class="score-sub">not scanned</span>
			{/if}
		</div>

		<div class="score-cell" class:score-danger={avatarAi !== null && avatarAi >= ALERT_THRESHOLD}>
			<span class="score-label">Avatar AI</span>
			<span class="score-value" style:color={scoreColor(avatarAi)}>{scoreLabel(avatarAi, 'ai')}</span>
			{#if avatarAi === null}
				<span class="score-sub">not scanned</span>
			{/if}
		</div>

		<div class="score-cell" class:score-danger={bannerAi !== null && bannerAi >= ALERT_THRESHOLD}>
			<span class="score-label">Banner AI</span>
			<span class="score-value" style:color={scoreColor(bannerAi)}>{scoreLabel(bannerAi, 'ai')}</span>
			{#if bannerAi === null}
				<span class="score-sub">not scanned</span>
			{/if}
		</div>
	</div>

	<div class="scan-actions">
		<button class="scan-btn" onclick={scanNsfw} disabled={scanningNsfw || scanningAi || !getBotOnline()}>
			{#if scanningNsfw}
				<Loader2 size={13} class="spin" />
				Scanning...
			{:else}
				<Shield size={13} />
				Scan NSFW
			{/if}
		</button>
		<button class="scan-btn" onclick={scanAi} disabled={scanningAi || scanningNsfw || !getBotOnline()}>
			{#if scanningAi}
				<Loader2 size={13} class="spin" />
				Scanning...
			{:else}
				<Sparkles size={13} />
				Scan AI
			{/if}
		</button>
	</div>

	{#if scanError}
		<span class="scan-error">{scanError}</span>
	{/if}
</div>

<style>
	.scan-panel {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.scan-alert {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.6rem;
		background: oklch(60% 0.15 25 / 0.1);
		border: 1px solid oklch(60% 0.15 25 / 0.25);
		border-radius: var(--radius-sm);
		color: var(--status-danger);
		font-size: 0.65rem;
		font-weight: 600;
	}

	.score-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.4rem;
	}

	.score-cell {
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.score-danger {
		border-color: oklch(60% 0.15 25 / 0.3);
		background: oklch(60% 0.15 25 / 0.05);
	}

	.score-label {
		font-size: 0.55rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-tertiary);
	}

	.score-value {
		font-size: 1rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.score-reason {
		font-size: 0.55rem;
		color: var(--text-muted);
	}

	.score-sub {
		font-size: 0.55rem;
		color: var(--text-muted);
		font-style: italic;
	}

	.scan-actions {
		display: flex;
		gap: 0.4rem;
	}

	.scan-btn {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		padding: 0.35rem 0.5rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-secondary);
		font-size: 0.65rem;
		font-weight: 600;
		cursor: pointer;
		transition: all var(--duration-fast) var(--ease-smooth);
	}

	.scan-btn:hover:not(:disabled) {
		background: var(--surface-raised);
		border-color: var(--accent-dim);
		color: var(--text-primary);
	}

	.scan-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.scan-error {
		font-size: 0.6rem;
		color: var(--status-danger);
	}

	:global(.spin) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	@media (max-width: 767px) {
		.score-grid {
			gap: 0.5rem;
		}
		.score-cell {
			padding: 0.5rem 0.625rem;
		}
		.score-value {
			font-size: 1.125rem;
		}
		.scan-btn {
			min-height: 44px;
			font-size: 0.7rem;
			padding: 0.5rem 0.625rem;
		}
		.scan-alert {
			padding: 0.5rem 0.75rem;
			font-size: 0.7rem;
		}
	}
</style>
