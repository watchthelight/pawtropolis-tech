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
	import { Sparkles, MessageSquare, Heart, Users } from 'lucide-svelte';

	let { data } = $props();
	let overview = $derived(data.overview);
	let timeseries = $derived(data.timeseries);
	let distribution = $derived(data.distribution);
	let leaderboards = $derived(data.leaderboards);
	let overlay = $derived(data.overlay);
	let backfill = $derived(data.backfill);
	let windowLabel = $derived(data.windowLabel);

	// Quality data updates via cron (~30 min cadence) so SSE-driven invalidation
	// would be noisy and pointless. Plain 5-minute polling while the tab is
	// foregrounded is enough to surface new scoring rounds.
	let pollTimer: ReturnType<typeof setInterval> | undefined;
	onMount(() => {
		pollTimer = setInterval(() => {
			if (document.visibilityState === 'visible') invalidateAll();
		}, 5 * 60 * 1000);
	});
	onDestroy(() => { if (pollTimer) clearInterval(pollTimer); });
</script>

<SpringReveal stagger={30}>
	<div class="quality-header">
		<PageHeader title="Quality" subtitle="Effort and resonance per #general message" />
		<TimeWindowSelector value={data.spec} />
	</div>

	<BackfillStatusBanner status={backfill} />

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
		<MetricsOverlayChart data={overlay} />
	</div>

	<h3 class="section-title">Leaderboards (≥{leaderboards.minMsgs} msgs in window)</h3>
	<div class="leaderboards">
		<LeaderboardTable rows={leaderboards.topEffort} title="Top 10 — highest mean effort" valueColumn="meanEffort" valueLabel="Effort" />
		<LeaderboardTable rows={leaderboards.workhorses} title="Top 10 — workhorses" subtitle="effort × log₁₀(msgs)" valueColumn="composite" valueLabel="Composite" />
		<LeaderboardTable rows={leaderboards.drains} title="Top 10 — most low-effort impact" subtitle="(1 − effort) × log₁₀(msgs)" valueColumn="drag" valueLabel="Drag" />
	</div>
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
	.leaderboards { display: grid; grid-template-columns: 1fr; gap: 1rem; }
	@media (min-width: 1100px) { .leaderboards { grid-template-columns: repeat(3, 1fr); } }
</style>
