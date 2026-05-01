<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import StatNumber from '$lib/components/data/StatNumber.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import TimeWindowSelector from '$lib/components/charts/TimeWindowSelector.svelte';
	import EffortTimeseriesChart from '$lib/components/quality/EffortTimeseriesChart.svelte';
	import EffortDistributionChart from '$lib/components/quality/EffortDistributionChart.svelte';
	import MetricsOverlayChart from '$lib/components/quality/MetricsOverlayChart.svelte';
	import LeaderboardTable from '$lib/components/quality/LeaderboardTable.svelte';
	import BackfillStatusBanner from '$lib/components/quality/BackfillStatusBanner.svelte';
	import SkeletonBlock from '$lib/components/feedback/SkeletonBlock.svelte';
	import { Sparkles, MessageSquare, Heart, Users, Brain } from 'lucide-svelte';
	import { windowToParams } from '$lib/shared/timeWindow';
	import type { BackfillStatus, OverlayWeek } from '$lib/shared/quality-types';

	let { data } = $props();
	let overview = $derived(data.overview);
	let timeseries = $derived(data.timeseries);
	let distribution = $derived(data.distribution);
	let leaderboardsPromise = $derived(data.streamed.leaderboards);
	let windowLabel = $derived(data.windowLabel);
	let substSparkline = $derived(data.substSparkline ?? []);
	let substTrend = $derived(data.substTrend);
	let overlay = $state<OverlayWeek[]>([]);
	let overlayLoading = $state(true);
	let overlayError = $state(false);
	let backfill = $state<BackfillStatus | null>(null);
	let backfillLoading = $state(true);
	let backfillError = $state(false);
	let overlayRequestSeq = 0;
	const overlayQuery = $derived(windowToParams(data.spec).toString());

	async function loadOverlay(query: string) {
		const requestId = ++overlayRequestSeq;
		overlayLoading = true;
		overlayError = false;
		try {
			const res = await fetch(`/dashboard/quality/overlay?${query}`);
			if (!res.ok) throw new Error(`Overlay request failed: ${res.status}`);
			const payload = await res.json() as { overlay: OverlayWeek[] };
			if (requestId === overlayRequestSeq) overlay = payload.overlay;
		} catch {
			if (requestId === overlayRequestSeq) {
				overlay = [];
				overlayError = true;
			}
		} finally {
			if (requestId === overlayRequestSeq) overlayLoading = false;
		}
	}

	async function loadBackfill() {
		backfillLoading = true;
		backfillError = false;
		try {
			const res = await fetch('/dashboard/quality/backfill');
			if (!res.ok) throw new Error(`Backfill request failed: ${res.status}`);
			const payload = await res.json() as { backfill: BackfillStatus };
			backfill = payload.backfill;
		} catch {
			backfill = null;
			backfillError = true;
		} finally {
			backfillLoading = false;
		}
	}

	$effect(() => {
		void loadOverlay(overlayQuery);
	});

	// Quality data updates via cron (~30 min cadence) so SSE-driven invalidation
	// would be noisy and pointless. Plain 5-minute polling while the tab is
	// foregrounded is enough to surface new scoring rounds.
	let pollTimer: ReturnType<typeof setInterval> | undefined;
	onMount(() => {
		void loadBackfill();
		pollTimer = setInterval(() => {
			if (document.visibilityState === 'visible') {
				invalidateAll();
				void loadBackfill();
			}
		}, 5 * 60 * 1000);
	});
	onDestroy(() => { if (pollTimer) clearInterval(pollTimer); });
</script>

<SpringReveal stagger={30}>
	<div class="quality-header">
		<PageHeader title="Quality" subtitle="Effort and resonance per #general message" />
		<TimeWindowSelector value={data.spec} />
	</div>

	{#if backfill}
		<BackfillStatusBanner status={backfill} />
	{:else if backfillLoading}
		<div class="banner-state">Loading backfill...</div>
	{:else if backfillError}
		<div class="banner-state">Backfill unavailable.</div>
	{/if}

	<div class="quality-grid">
		<div class="card">
			<div class="card-icon-row">
				<Sparkles size={16} color="var(--accent)" />
			</div>
			<span class="card-label">Mean effort</span>
			<StatNumber value={Math.round(overview.meanEffort * 1000) / 1000} label="" />
			<span class="card-sub">LLM-distilled rubric, {windowLabel}</span>
		</div>

		<div class="card">
			<div class="card-icon-row">
				<Heart size={16} color="var(--text-tertiary)" />
			</div>
			<span class="card-label">Mean resonance</span>
			<StatNumber value={Math.round(overview.meanResonance * 1000) / 1000} label="" />
			<span class="card-sub">reply-graph engagement</span>
		</div>

		<div class="card">
			<div class="card-icon-row">
				<Brain size={16} color="var(--accent)" />
			</div>
			<span class="card-label">Mean substantiveness</span>
			<StatNumber value={Math.round(overview.meanSubstantiveness * 1000) / 1000} label="" />
			<span class="card-sub">novelty + density − filler</span>
		</div>

		<div class="card">
			<div class="card-icon-row">
				<MessageSquare size={16} color="var(--text-tertiary)" />
			</div>
			<span class="card-label">Low-effort share</span>
			<StatNumber value={Math.round(overview.lowEffortShare * 1000) / 10} label="" />
			<span class="card-sub">% of msgs with effort &lt; 0.20</span>
		</div>

		<div class="card">
			<div class="card-icon-row">
				<Users size={16} color="var(--text-tertiary)" />
			</div>
			<span class="card-label">Distinct authors</span>
			<StatNumber value={overview.distinctAuthors} label="" />
			<span class="card-sub">{overview.totalScored.toLocaleString()} msgs scored</span>
		</div>
	</div>

	{#if substSparkline.length >= 4 && substTrend}
		{@const W = 600}
		{@const H = 80}
		{@const efforts = substSparkline.map(p => p.effort)}
		{@const subs = substSparkline.map(p => p.substantiveness)}
		{@const all = [...efforts, ...subs].filter(v => v > 0)}
		{@const lo = Math.min(...all)}
		{@const hi = Math.max(...all)}
		{@const span = hi - lo || 1}
		{@const xStep = W / Math.max(1, substSparkline.length - 1)}
		{@const px = (i: number) => i * xStep}
		{@const py = (v: number) => H - ((v - lo) / span) * (H - 8) - 4}
		{@const eLine = efforts.map((v, i) => `${i === 0 ? 'M' : 'L'} ${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(' ')}
		{@const sLine = subs.map((v, i) => `${i === 0 ? 'M' : 'L'} ${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(' ')}
		<div class="card spark-card">
			<div class="spark-meta">
				<span class="spark-title">Last 12 weeks</span>
				<span class="spark-legend">
					<span class="spark-dot spark-effort"></span> Effort
					<span class="spark-dot spark-subst"></span> Substantiveness
				</span>
			</div>
			<svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" class="spark-svg" aria-hidden="true">
				<path d={eLine} class="spark-effort-path" fill="none" />
				<path d={sLine} class="spark-subst-path"  fill="none" />
			</svg>
			<p class="spark-interp">{substTrend.interpretation}</p>
		</div>
	{/if}

	<h3 class="section-title">Effort + resonance over time</h3>
	<div class="card chart-card">
		<EffortTimeseriesChart data={timeseries} />
	</div>

	<h3 class="section-title">Effort score distribution ({windowLabel})</h3>
	<div class="card chart-card">
		<EffortDistributionChart data={distribution} />
	</div>

	<h3 class="section-title">10 quality metrics overlaid</h3>
	<div class="card chart-card">
		{#if overlayLoading}
			<div class="overlay-state">Loading overlay...</div>
		{:else if overlayError}
			<div class="overlay-state">Overlay unavailable.</div>
		{:else}
			<MetricsOverlayChart data={overlay} />
		{/if}
	</div>

	{#await leaderboardsPromise}
		<h3 class="section-title">Leaderboards</h3>
		<div class="leaderboards">
			{#each [0, 1, 2] as _i}
				<div class="card">
					<SkeletonBlock width="60%" height="0.9rem" />
					<div style="margin-top: 12px;">
						{#each [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as _row}
							<div style="display: flex; justify-content: space-between; padding: 6px 0;">
								<SkeletonBlock width="60%" height="0.8rem" />
								<SkeletonBlock width="20%" height="0.8rem" />
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{:then leaderboards}
		<h3 class="section-title">Leaderboards (≥{leaderboards.minMsgs} msgs in window)</h3>
		<div class="leaderboards">
			<LeaderboardTable rows={leaderboards.topEffort} title="Top 10 — highest mean effort" valueColumn="meanEffort" valueLabel="Effort" />
			<LeaderboardTable rows={leaderboards.workhorses} title="Top 10 — workhorses" subtitle="effort × log₁₀(msgs)" valueColumn="composite" valueLabel="Composite" />
			<LeaderboardTable rows={leaderboards.drains} title="Top 10 — most low-effort impact" subtitle="(1 − effort) × log₁₀(msgs)" valueColumn="drag" valueLabel="Drag" />
		</div>
	{:catch}
		<h3 class="section-title">Leaderboards</h3>
		<div class="banner-state">Leaderboards unavailable.</div>
	{/await}
</SpringReveal>

<style>
	.quality-header { display: flex; justify-content: space-between; align-items: flex-end; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; }
	.quality-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-top: 1.5rem; }
	.card { background: var(--surface, #14171c); border: 1px solid var(--border, #1f232c); border-radius: var(--radius-md, 8px); padding: var(--space-card, 16px); }
	.card-icon-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
	.card-label { display: block; color: var(--text-tertiary); font-size: 0.7rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
	.card-sub { display: block; color: var(--text-secondary); font-size: 0.7rem; margin-top: 0.25rem; }
	.section-title { margin: 1.75rem 0 0.5rem; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-secondary); }
	.chart-card { padding: 18px; }
	.banner-state { background: var(--surface, #14171c); border: 1px solid var(--border, #1f232c); border-radius: var(--radius-md, 8px); padding: 12px 16px; color: var(--text-secondary); font-size: 12px; }
	.overlay-state { min-height: 360px; display: grid; place-items: center; color: var(--text-secondary); font-size: 0.82rem; }
	.leaderboards { display: grid; grid-template-columns: 1fr; gap: 1rem; }
	@media (min-width: 1100px) { .leaderboards { grid-template-columns: repeat(3, 1fr); } }

	.spark-card { margin-top: 1rem; padding: 14px 18px; }
	.spark-meta { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
	.spark-title { font-size: 0.7rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-tertiary); }
	.spark-legend { display: flex; gap: 14px; align-items: center; font-size: 0.72rem; color: var(--text-secondary); }
	.spark-dot { display: inline-block; width: 18px; height: 3px; vertical-align: middle; margin-right: 4px; border-radius: 1px; }
	.spark-dot.spark-effort { background: #d4a368; }
	.spark-dot.spark-subst  { background: var(--accent, #c850c0); }
	.spark-svg { width: 100%; height: 80px; display: block; margin: 4px 0 6px; }
	.spark-effort-path { stroke: #d4a368; stroke-width: 2; }
	.spark-subst-path  { stroke: var(--accent, #c850c0); stroke-width: 2; }
	.spark-interp { margin: 4px 0 0; color: var(--text-primary); font-size: 0.85rem; line-height: 1.4; }
</style>
