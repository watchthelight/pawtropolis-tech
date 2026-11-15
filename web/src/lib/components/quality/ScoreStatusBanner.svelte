<script lang="ts">
	import type { ScoreStatus } from '$lib/shared/quality-types';

	let { status, nowS }: { status: ScoreStatus; nowS: number } = $props();

	// The job runs every 15 minutes. Three missed runs in a row are worth a word.
	const STALE_AFTER_S = 45 * 60;

	const oldest = $derived(
		status.oldestS === null ? null : new Date(status.oldestS * 1000).toISOString().slice(0, 10)
	);
	const ageS = $derived(status.lastRunS === null ? null : Math.max(0, nowS - status.lastRunS));
	const stale = $derived(ageS === null || ageS > STALE_AFTER_S);

	function ago(seconds: number): string {
		const some = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
		if (seconds < 90) return 'a minute ago';
		if (seconds < 3600) return some(Math.round(seconds / 60), 'minute');
		if (seconds < 2 * 86400) return some(Math.round(seconds / 3600), 'hour');
		return some(Math.round(seconds / 86400), 'day');
	}
</script>

<div class="banner" class:stale>
	<span class="dot" class:busy={!stale && status.pending > 0} aria-hidden="true"></span>
	<p class="line">
		<b>{status.total.toLocaleString()}</b> messages scored{#if oldest}, the oldest from {oldest}{/if}.
		{#if ageS === null}
			The job has not finished a run on this host yet.
		{:else if stale}
			The job last ran {ago(ageS)}. New messages get no score until it runs again.
		{:else}
			Last run {ago(ageS)}{#if status.pending > 0}, {status.pending.toLocaleString()} messages still waiting{/if}.
		{/if}
	</p>
</div>

<style>
	.banner {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		background: var(--surface);
		border: 1px solid var(--line-soft);
		border-radius: var(--radius-md);
		padding: 0.6rem 0.9rem;
		font-size: 0.78rem;
		color: var(--ink-2);
	}

	.banner.stale {
		border-color: var(--warn);
	}

	.line {
		margin: 0;
		line-height: 1.45;
	}

	.line b {
		color: var(--ink);
		font-weight: 600;
	}

	.dot {
		flex: none;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--good);
		transform: translateY(-1px);
	}

	.stale .dot {
		background: var(--warn);
	}

	.dot.busy {
		animation: waiting 1.6s ease-in-out infinite;
	}

	@keyframes waiting {
		50% {
			opacity: 0.35;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.dot.busy {
			animation: none;
		}
	}
</style>
