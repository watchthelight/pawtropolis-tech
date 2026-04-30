<script lang="ts">
	import type { BackfillStatus } from '$lib/shared/quality-types';

	let { status }: { status: BackfillStatus } = $props();

	const oldestIso = $derived(status.oldestRawTs ? new Date(status.oldestRawTs * 1000).toISOString().slice(0, 10) : '—');
	const pct = $derived(status.totalRaw > 0 ? Math.round((status.scoredEffort / status.totalRaw) * 100) : 0);
	const inFlight = $derived(status.pendingCtx > 0 || status.pendingEmbed > 0 || status.pendingEffort > 0);
</script>

<div class="banner" class:active={inFlight}>
	<div class="row">
		<span class="dot" class:on={inFlight}></span>
		<b>Backfill</b>
		<span class="sub">{status.totalRaw.toLocaleString()} messages captured · oldest {oldestIso}</span>
	</div>
	<div class="row stats">
		<span><b>{pct}%</b> scored ({status.scoredEffort.toLocaleString()} / {status.totalRaw.toLocaleString()})</span>
		{#if status.pendingCtx > 0}<span>{status.pendingCtx.toLocaleString()} pending ctx</span>{/if}
		{#if status.pendingEmbed > 0}<span>{status.pendingEmbed.toLocaleString()} pending embed</span>{/if}
		{#if status.pendingEffort > 0}<span>{status.pendingEffort.toLocaleString()} pending effort</span>{/if}
	</div>
	<div class="bar">
		<div class="fill" style="width: {pct}%;"></div>
	</div>
</div>

<style>
	.banner { background: var(--surface, #14171c); border: 1px solid var(--border, #1f232c); border-radius: var(--radius-md, 8px); padding: 12px 16px; font-size: 12px; }
	.banner.active { border-color: #f0b86e55; }
	.row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
	.row.stats { color: var(--text-secondary); margin-top: 4px; }
	.row.stats b { color: var(--text-primary); font-weight: 600; }
	.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-secondary); display: inline-block; }
	.dot.on { background: #f0b86e; box-shadow: 0 0 6px #f0b86e88; animation: pulse 1.6s ease-in-out infinite; }
	@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
	.sub { color: var(--text-secondary); font-size: 11px; }
	.bar { margin-top: 8px; background: #1a1d24; border-radius: 999px; height: 4px; overflow: hidden; }
	.fill { height: 100%; background: linear-gradient(90deg, #f0b86e, #6ea7f0); transition: width 400ms ease; }
</style>
