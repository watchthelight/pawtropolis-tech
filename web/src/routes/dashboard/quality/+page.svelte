<script lang="ts">
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

	let { data } = $props();
	let overview = $derived(data.overview);
	let timeseries = $derived(data.timeseries);
	let distribution = $derived(data.distribution);
	let leaderboardsPromise = $derived(data.streamed.leaderboards);
	let overlayPromise = $derived(data.streamed.overlay);
	let backfillPromise = $derived(data.streamed.backfill);
	let windowLabel = $derived(data.windowLabel);
	let substSparkline = $derived(data.substSparkline ?? []);
	let substTrend = $derived(data.substTrend);

	// Convert a 0–1 score into a friendly percent + qualitative band. Avoids the
	// "what does 0.239 mean" problem on the tile face. Tenths of a percent so the
	// number still moves visibly week-to-week.
	function pct(v: number): string {
		return `${(v * 100).toFixed(1)}%`;
	}
	function effortBand(v: number): string {
		if (v >= 0.50) return 'High effort — substantive room';
		if (v >= 0.30) return 'Above-average effort';
		if (v >= 0.20) return 'Typical chat effort';
		return 'Low — mostly quick replies';
	}
	function substBand(v: number): string {
		if (v >= 0.85) return 'Dense, novel content';
		if (v >= 0.70) return 'Solid signal-to-noise';
		if (v >= 0.55) return 'Mixed, some filler';
		return 'Heavy filler';
	}
	function resonanceBand(v: number): string {
		if (v >= 0.40) return 'Many replies on average';
		if (v >= 0.25) return 'Healthy reply rate';
		if (v >= 0.15) return 'Conversations form sometimes';
		return 'Most messages stand alone';
	}
	function lowEffortBand(v: number): string {
		// v = fraction (0..1) of msgs below 0.20 effort
		if (v <= 0.25) return 'Low share of filler messages';
		if (v <= 0.40) return 'About average for chat servers';
		if (v <= 0.55) return 'Filler is starting to dominate';
		return 'Very high filler share';
	}
	function trendArrow(deltaPct: number): { sign: string; cls: string } {
		if (deltaPct > 0.5) return { sign: '▲', cls: 'trend-up' };
		if (deltaPct < -0.5) return { sign: '▼', cls: 'trend-down' };
		return { sign: '·', cls: 'trend-flat' };
	}
</script>

<SpringReveal stagger={30}>
	<div class="quality-header">
		<PageHeader title="Quality" subtitle="Effort, resonance and substantiveness per #general message" />
		<TimeWindowSelector value={data.spec} />
	</div>

	{#await backfillPromise}
		<div class="banner-state">Loading backfill…</div>
	{:then backfill}
		{#if backfill}
			<BackfillStatusBanner status={backfill} />
		{/if}
	{:catch}
		<div class="banner-state">Backfill status unavailable.</div>
	{/await}

	<div class="quality-grid">
		<!-- Mean effort -->
		<div class="card">
			<div class="card-icon-row">
				<Sparkles size={16} color="var(--accent)" />
				{#if substTrend && substTrend.deltaEffortPct}
					{@const a = trendArrow(substTrend.deltaEffortPct)}
					<span class="trend-pill {a.cls}">{a.sign} {Math.abs(substTrend.deltaEffortPct).toFixed(1)}%</span>
				{/if}
			</div>
			<span class="card-label">Mean effort</span>
			<span class="big-pct">{pct(overview.meanEffort)}</span>
			<span class="card-sub">0% = filler · 100% = essay-quality. {windowLabel}.</span>
			<span class="card-band">{effortBand(overview.meanEffort)}</span>
		</div>

		<!-- Mean resonance -->
		<div class="card">
			<div class="card-icon-row">
				<Heart size={16} color="var(--text-tertiary)" />
			</div>
			<span class="card-label">Mean resonance</span>
			<span class="big-pct">{pct(overview.meanResonance)}</span>
			<span class="card-sub">How often a message attracts replies, normalised to 0–100%.</span>
			<span class="card-band">{resonanceBand(overview.meanResonance)}</span>
		</div>

		<!-- Mean substantiveness -->
		<div class="card">
			<div class="card-icon-row">
				<Brain size={16} color="var(--accent)" />
				{#if substTrend && substTrend.deltaSubstPct}
					{@const a = trendArrow(substTrend.deltaSubstPct)}
					<span class="trend-pill {a.cls}">{a.sign} {Math.abs(substTrend.deltaSubstPct).toFixed(1)}%</span>
				{/if}
			</div>
			<span class="card-label">Mean substantiveness</span>
			<span class="big-pct">{pct(overview.meanSubstantiveness)}</span>
			<span class="card-sub">Density and novelty after subtracting filler tokens.</span>
			<span class="card-band">{substBand(overview.meanSubstantiveness)}</span>
		</div>

		<!-- Low-effort share -->
		<div class="card">
			<div class="card-icon-row">
				<MessageSquare size={16} color="var(--text-tertiary)" />
			</div>
			<span class="card-label">Low-effort share</span>
			<span class="big-pct">{pct(overview.lowEffortShare)}</span>
			<span class="card-sub">Share of messages scoring under 20% effort.</span>
			<span class="card-band">{lowEffortBand(overview.lowEffortShare)}</span>
		</div>

		<!-- Distinct authors -->
		<div class="card">
			<div class="card-icon-row">
				<Users size={16} color="var(--text-tertiary)" />
			</div>
			<span class="card-label">Distinct authors</span>
			<StatNumber value={overview.distinctAuthors} label="" />
			<span class="card-sub">Unique humans speaking, out of {overview.totalScored.toLocaleString()} scored messages.</span>
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
		{#await overlayPromise}
			<div class="overlay-state">Loading overlay…</div>
		{:then overlay}
			<MetricsOverlayChart data={overlay} />
		{:catch}
			<div class="overlay-state">Overlay unavailable.</div>
		{/await}
	</div>

	{#await leaderboardsPromise}
		<div class="leaderboards-header">
			<h3 class="section-title">Top contributors</h3>
			<p class="section-blurb">Ranked over {windowLabel}, anyone with at least 200 messages.</p>
		</div>
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
		<div class="leaderboards-header">
			<h3 class="section-title">Top contributors</h3>
			<p class="section-blurb">
				Ranked over {windowLabel}, anyone with at least {leaderboards.minMsgs} messages.
				Three lenses on the same data — average quality, total signal, total drag.
			</p>
		</div>
		<div class="leaderboards">
			<LeaderboardTable
				rows={leaderboards.topEffort}
				title="Highest mean effort"
				subtitle="Who writes the most thoughtful messages on average. Effort 0–100%."
				valueColumn="meanEffort"
				valueLabel="Effort %"
			/>
			<LeaderboardTable
				rows={leaderboards.workhorses}
				title="Workhorses"
				subtitle="Who carries the most thoughtful volume. Mean effort multiplied by log of message count."
				valueColumn="composite"
				valueLabel="Composite"
			/>
			<LeaderboardTable
				rows={leaderboards.drains}
				title="Most low-effort impact"
				subtitle="Whose volume of low-effort messages drags the room. (1 − effort) × log of message count."
				valueColumn="drag"
				valueLabel="Drag"
			/>
		</div>
	{:catch}
		<h3 class="section-title">Top contributors</h3>
		<div class="banner-state">Leaderboards unavailable.</div>
	{/await}
</SpringReveal>

<style>
	.quality-header { display: flex; justify-content: space-between; align-items: flex-end; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; }
	.quality-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-top: 1.5rem; }
	.card { background: var(--surface, #14171c); border: 1px solid var(--border, #1f232c); border-radius: var(--radius-md, 8px); padding: var(--space-card, 16px); }
	.card-icon-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; justify-content: space-between; }
	.card-label { display: block; color: var(--text-tertiary); font-size: 0.7rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
	.card-sub { display: block; color: var(--text-secondary); font-size: 0.7rem; margin-top: 0.25rem; line-height: 1.35; }
	.card-band { display: block; color: var(--text-primary); font-size: 0.72rem; margin-top: 0.4rem; opacity: 0.85; }
	.section-title { margin: 1.75rem 0 0.5rem; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-secondary); }
	.section-blurb { margin: -0.25rem 0 0.6rem; color: var(--text-secondary); font-size: 0.78rem; max-width: 64ch; line-height: 1.4; }
	.leaderboards-header { display: flex; flex-direction: column; }
	.chart-card { padding: 18px; }
	.banner-state { background: var(--surface, #14171c); border: 1px solid var(--border, #1f232c); border-radius: var(--radius-md, 8px); padding: 12px 16px; color: var(--text-secondary); font-size: 12px; }
	.overlay-state { min-height: 360px; display: grid; place-items: center; color: var(--text-secondary); font-size: 0.82rem; }
	.leaderboards { display: grid; grid-template-columns: 1fr; gap: 1rem; }
	@media (min-width: 1100px) { .leaderboards { grid-template-columns: repeat(3, 1fr); } }

	.trend-pill {
		font-size: 0.65rem;
		font-weight: 600;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		font-variant-numeric: tabular-nums;
	}
	.trend-up { background: oklch(28% 0.06 145); color: oklch(80% 0.14 145); }
	.trend-down { background: oklch(28% 0.06 25); color: oklch(80% 0.14 25); }
	.trend-flat { background: var(--surface-raised); color: var(--text-tertiary); }

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
	.big-pct {
		display: block;
		font-size: clamp(1.75rem, 4vw, 2.5rem);
		font-weight: 700;
		color: var(--text-primary);
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
	}
</style>
