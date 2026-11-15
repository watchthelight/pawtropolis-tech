<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import TimeWindowSelector from '$lib/components/charts/TimeWindowSelector.svelte';
	import WeekLineChart from '$lib/components/quality/WeekLineChart.svelte';
	import EffortDistributionChart from '$lib/components/quality/EffortDistributionChart.svelte';
	import LeaderboardTable from '$lib/components/quality/LeaderboardTable.svelte';
	import ScoreStatusBanner from '$lib/components/quality/ScoreStatusBanner.svelte';
	import { WEEKLY_MEASURES, type WeeklyMeasure } from '$lib/shared/quality-types';
	import { Sparkles, MessageSquare, Heart, Users, Brain } from 'lucide-svelte';

	let { data } = $props();
	let scores = $derived(data.scores);
	let windowLabel = $derived(data.windowLabel);

	// One hovered week for every chart on the page, so they are read together.
	let hoverWeek = $state<number | null>(null);

	const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
	const plain = (value: number) => (Number.isInteger(value) ? `${value}` : value.toFixed(1));
	// Axis ticks fall on whole percents nearly always, and then they need no decimal.
	const pctTick = (value: number) => `${plain(Math.round(value * 1000) / 10)}%`;

	// What a chart needs to know about the unit of its measure. A share lies between 0 and 1,
	// and its axis spans ten points or more, so a wobble of a point is not drawn as a swing.
	const SHARE = { format: pct, tickFormat: pctTick, minSpan: 0.1, limits: [0, 1] as [number, number] };
	const WORDS = { format: plain, tickFormat: plain, minSpan: 4, limits: [0, Infinity] as [number, number] };
	const axisOf = (measure: WeeklyMeasure) => (measure.unit === 'share' ? SHARE : WORDS);

	// On the window over all time the two numbers would be the same.
	let showAllTime = $derived(!(data.spec.kind === 'preset' && data.spec.preset === 'all'));

	let effortPoints = $derived(
		(scores?.summary.weeks ?? []).map((week) => ({
			weekStart: week.weekStart,
			value: week.rolling4w,
			faint: week.meanEffort,
			note: `${week.count.toLocaleString()} messages, ${Math.round(week.lowEffortShare * 100)}% of them low effort`
		}))
	);
	let effortByWeek = $derived(new Map((scores?.summary.weeks ?? []).map((week) => [week.weekStart, week])));
	let measureWeeks = $derived(scores?.measures ?? []);
</script>

<SpringReveal stagger={30}>
	<div class="quality-header">
		<PageHeader title="Quality" subtitle="How much the messages of the main chat have in them, by week and by author" />
		<TimeWindowSelector value={data.spec} />
	</div>

	{#if !data.status || !scores}
		<EmptyState
			message="No scores on this host yet"
			subtitle="The research job keeps them in a file of its own, and that file is not there. The page fills in after the job's first run."
		/>
	{:else}
		{@const overview = scores.summary.overview}
		{@const allTime = showAllTime ? scores.allTime : null}
		{@const trend = scores.trend}
		<ScoreStatusBanner status={data.status} nowS={data.nowS} />

		<div class="tiles">
			<div class="card">
				<div class="card-icon-row"><Sparkles size={16} color="var(--sage)" /></div>
				<span class="card-label">Mean effort</span>
				<span class="big">{pct(overview.meanEffort)}</span>
				<span class="card-sub">What the effort model gives a message, from 0% for a throwaway line to 100%.</span>
				{#if allTime}<span class="card-ref">All time: {pct(allTime.effort)}</span>{/if}
			</div>

			<div class="card">
				<div class="card-icon-row"><Brain size={16} color="var(--ink-3)" /></div>
				<span class="card-label">Mean substantiveness</span>
				<span class="big">{pct(overview.meanSubstantiveness)}</span>
				<span class="card-sub">New against the messages before it, not a stock phrase, varied words.</span>
				{#if allTime}<span class="card-ref">All time: {pct(allTime.substantiveness)}</span>{/if}
			</div>

			<div class="card">
				<div class="card-icon-row"><Heart size={16} color="var(--ink-3)" /></div>
				<span class="card-label">Mean resonance</span>
				<span class="big">{pct(overview.meanResonance)}</span>
				<span class="card-sub">Replies a message drew. The 95th percentile of all messages counts as 100%.</span>
				{#if allTime}<span class="card-ref">All time: {pct(allTime.resonance)}</span>{/if}
			</div>

			<div class="card">
				<div class="card-icon-row"><MessageSquare size={16} color="var(--ink-3)" /></div>
				<span class="card-label">Low-effort share</span>
				<span class="big">{pct(overview.lowEffortShare)}</span>
				<span class="card-sub">Messages with an effort score under 20%.</span>
			</div>

			<div class="card">
				<div class="card-icon-row"><Users size={16} color="var(--ink-3)" /></div>
				<span class="card-label">Authors</span>
				<span class="big">{scores.boards.distinctAuthors.toLocaleString()}</span>
				<span class="card-sub">wrote the {overview.totalScored.toLocaleString()} messages scored in this window.</span>
			</div>
		</div>

		{#if trend}
			<h3 class="section-title">The last 12 weeks</h3>
			<div class="card">
				<p class="trend-sentence">{trend.sentence}</p>
				<div class="trend-pair">
					<div>
						<span class="card-label">Effort</span>
						<WeekLineChart
							compact
							height={96}
							points={trend.weeks.map((week) => ({ weekStart: week.weekStart, value: week.effort }))}
							{...SHARE}
							label="Mean effort over the last 12 weeks"
							bind:hoverWeek
						/>
						<span class="card-sub">Last four weeks {pct(trend.effort.current)}, the four before {pct(trend.effort.prior)}.</span>
					</div>
					<div>
						<span class="card-label">Substantiveness</span>
						<WeekLineChart
							compact
							height={96}
							points={trend.weeks.map((week) => ({ weekStart: week.weekStart, value: week.substantiveness }))}
							{...SHARE}
							label="Mean substantiveness over the last 12 weeks"
							bind:hoverWeek
						/>
						<span class="card-sub">
							Last four weeks {pct(trend.substantiveness.current)}, the four before {pct(trend.substantiveness.prior)}.
						</span>
					</div>
				</div>
			</div>
		{/if}

		<h3 class="section-title">Effort by week ({windowLabel})</h3>
		<div class="card">
			<WeekLineChart
				points={effortPoints}
				{...SHARE}
				label="Mean effort by week, with its mean over four weeks"
				valueName="mean over four weeks"
				faintName="that week"
				bind:hoverWeek
			/>
			<span class="card-sub">
				Each point here and in the charts below is a whole week, Monday to Sunday in UTC, also where the window
				begins or ends inside it.
			</span>
		</div>

		<h3 class="section-title">Spread of the effort scores ({windowLabel})</h3>
		<div class="card">
			<EffortDistributionChart data={scores.summary.bins} />
			<details class="numbers">
				<summary>The spread as a table</summary>
				<!-- svelte-ignore a11y_no_noninteractive_tabindex (a box that scrolls has to take focus, or the keyboard cannot scroll it) -->
				<div class="table-scroll" role="region" aria-label="The spread as a table" tabindex="0">
					<table>
						<thead>
							<tr><th scope="col">Effort score</th><th scope="col" class="num">Messages</th><th scope="col" class="num">Share</th></tr>
						</thead>
						<tbody>
							{#each scores.summary.bins as bin (bin.binStart)}
								<tr>
									<td>{Math.round(bin.binStart * 100)}% to {Math.round(bin.binEnd * 100)}%</td>
									<td class="num">{bin.count.toLocaleString()}</td>
									<td class="num">{overview.totalScored > 0 ? pct(bin.count / overview.totalScored) : pct(0)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</details>
		</div>

		<h3 class="section-title">Other weekly measures ({windowLabel})</h3>
		<div class="measures">
			{#each WEEKLY_MEASURES as measure (measure.key)}
				<div class="card">
					<span class="card-label">{measure.label}</span>
					<WeekLineChart
						compact
						height={104}
						points={measureWeeks.map((week) => ({ weekStart: week.weekStart, value: week.values[measure.key] }))}
						{...axisOf(measure)}
						label="{measure.label} by week"
						valueName={measure.unit === 'words' ? 'words' : ''}
						bind:hoverWeek
					/>
					<span class="card-sub">{measure.hint}</span>
				</div>
			{/each}
		</div>
		<details class="numbers apart">
			<summary>The weekly numbers as a table</summary>
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (a box that scrolls has to take focus, or the keyboard cannot scroll it) -->
			<div class="table-scroll" role="region" aria-label="The weekly numbers as a table" tabindex="0">
				<table>
					<thead>
						<tr>
							<th scope="col">Week of</th>
							<th scope="col" class="num">Messages</th>
							<th scope="col" class="num">Effort</th>
							{#each WEEKLY_MEASURES as measure (measure.key)}
								<th scope="col" class="num">{measure.label}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each measureWeeks as week (week.weekStart)}
							{@const effort = effortByWeek.get(week.weekStart)}
							<tr>
								<td>{week.iso}</td>
								<td class="num">{week.count.toLocaleString()}</td>
								<td class="num">{effort ? pct(effort.meanEffort) : ''}</td>
								{#each WEEKLY_MEASURES as measure (measure.key)}
									<td class="num">{axisOf(measure).format(week.values[measure.key])}</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</details>

		<h3 class="section-title">Authors ({windowLabel})</h3>
		<p class="blurb">
			Everyone with at least {scores.boards.minMsgs} scored messages in the window, seen three ways. The scores are
			estimates from a small model and they rate messages, not people: read a board as a hint about where to look.
		</p>
		<div class="boards">
			<LeaderboardTable
				rows={scores.boards.topEffort}
				title="Highest mean effort"
				subtitle="Whose messages score highest on average."
			/>
			<LeaderboardTable
				rows={scores.boards.workhorses}
				title="Most effort in total"
				subtitle="Mean effort times the logarithm of the message count: people who write a lot, and write it well."
				rankedBy={{ column: 'composite', label: 'Total' }}
			/>
			<LeaderboardTable
				rows={scores.boards.drains}
				title="Most low-effort volume"
				subtitle="One minus mean effort, times the logarithm of the message count: many messages with little in them."
				rankedBy={{ column: 'drag', label: 'Volume' }}
			/>
		</div>
	{/if}
</SpringReveal>

<style>
	.quality-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 0.5rem;
	}

	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
		gap: 1rem;
		margin-top: 1rem;
	}

	.card {
		background: var(--surface);
		border: 1px solid var(--line-soft);
		border-radius: var(--radius-md);
		padding: var(--space-card);
		box-shadow: var(--shadow-sm);
		min-width: 0;
	}

	.card-icon-row {
		display: flex;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.card-label {
		display: block;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--ink-3);
		margin-bottom: 0.5rem;
	}

	.card-sub {
		display: block;
		font-size: 0.7rem;
		line-height: 1.4;
		color: var(--ink-2);
		margin-top: 0.25rem;
	}

	.card-ref {
		display: block;
		font-size: 0.7rem;
		color: var(--ink-3);
		margin-top: 0.4rem;
	}

	.big {
		display: block;
		font-size: clamp(1.75rem, 4vw, 2.4rem);
		font-weight: 700;
		line-height: 1.1;
		color: var(--ink);
	}

	.section-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--ink-2);
		margin: 1.5rem 0 0.5rem;
	}

	.section-title::before {
		content: '';
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--sage);
		flex-shrink: 0;
	}

	.trend-sentence {
		margin: 0 0 0.9rem;
		font-size: 0.9rem;
		line-height: 1.4;
		color: var(--ink);
	}

	.trend-pair {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 1.25rem;
	}

	.trend-pair > div {
		min-width: 0;
	}

	.measures {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
		gap: 1rem;
	}

	.blurb {
		margin: 0 0 0.75rem;
		max-width: 72ch;
		font-size: 0.78rem;
		line-height: 1.45;
		color: var(--ink-2);
	}

	.boards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(330px, 1fr));
		gap: 1rem;
	}

	.numbers {
		margin-top: 0.75rem;
		font-size: 0.75rem;
		color: var(--ink-2);
	}

	.numbers summary {
		cursor: pointer;
		color: var(--ink-3);
	}

	/* A table scrolls inside its own box. The dashboard's main column is a flex item and would
	   grow to the widest table on the page: inline-size containment keeps the width in here. */
	.table-scroll {
		overflow: auto;
		max-height: 26rem;
		margin-top: 0.5rem;
		contain: inline-size;
	}

	.table-scroll:focus-visible {
		outline: 1px solid var(--line-strong);
		outline-offset: 2px;
	}

	/* The table that stands outside a card brings its own surface. */
	.apart .table-scroll {
		background: var(--surface);
		border: 1px solid var(--line-soft);
		border-radius: var(--radius-md);
	}

	/* Separate borders: with collapsed ones the line under a sticky heading scrolls away. */
	.numbers table {
		border-collapse: separate;
		border-spacing: 0;
		white-space: nowrap;
	}

	.numbers th,
	.numbers td {
		padding: 0.3rem 0.7rem 0.3rem 0;
		border-bottom: 1px solid var(--line-soft);
		text-align: left;
	}

	.apart th:first-child,
	.apart td:first-child {
		padding-left: 0.9rem;
	}

	.numbers th {
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--surface);
		font-size: 0.62rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-3);
	}

	/* The row's name stays in sight while the numbers scroll sideways. */
	.numbers th:first-child,
	.numbers td:first-child {
		position: sticky;
		left: 0;
		background: var(--surface);
	}

	.numbers th:first-child {
		z-index: 2;
	}

	.numbers .num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
</style>
