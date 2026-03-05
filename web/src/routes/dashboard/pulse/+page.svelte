<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import StatNumber from '$lib/components/data/StatNumber.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';

	let { data } = $props();
	let metrics = $derived(data.metrics);
</script>

<SpringReveal stagger={30}>
	<PageHeader title="Pulse" subtitle="Server overview at a glance" />

	<div class="pulse-grid">
		<a href="/dashboard/reviews" class="card clickable">
			<span class="card-label">Pending Applications</span>
			<StatNumber value={metrics.pendingApps} label="" />
			<span class="card-sub">{metrics.pendingApps === 0 ? 'All clear' : 'in the queue'}</span>
		</a>

		<div class="card">
			<span class="card-label">Open Modmail</span>
			<StatNumber value={metrics.openModmail} label="" />
			<span class="card-sub">{metrics.openModmail === 0 ? 'No open threads' : 'active threads'}</span>
		</div>

		<a href="/dashboard/flags" class="card clickable">
			<span class="card-label">Active Flags</span>
			<StatNumber value={metrics.activeFlags} label="" />
			<span class="card-sub">{metrics.activeFlags === 0 ? 'No active flags' : 'awaiting review'}</span>
		</a>

		<div class="card">
			<span class="card-label">Decisions Today</span>
			<StatNumber value={metrics.decisionsToday} label="" />
			<span class="card-sub">{metrics.decisionsToday === 0 ? 'No decisions yet' : 'team actions today'}</span>
		</div>
	</div>

	<h3 class="section-title">Membership</h3>
	<div class="pulse-grid">
		<div class="card">
			<span class="card-label">Total Tracked</span>
			<StatNumber value={metrics.totalMembers} label="" />
			<span class="card-sub">members in database</span>
		</div>

		<div class="card highlight-green">
			<span class="card-label">Estimated Real Users</span>
			<StatNumber value={metrics.estimatedRealUsers} label="" />
			<span class="card-sub">members with activity</span>
		</div>

		<div class="card">
			<span class="card-label">Estimated Bots</span>
			<StatNumber value={metrics.estimatedBots} label="" />
			<span class="card-sub">no messages or activity</span>
		</div>

		<div class="card highlight-green">
			<span class="card-label">Active Real Users</span>
			<StatNumber value={metrics.activeRealUsers} label="" />
			<span class="card-sub">100+ msgs in last 14 days</span>
		</div>
	</div>
</SpringReveal>

<style>
	.pulse-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
	}

	.card {
		background: var(--surface);
		border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-md);
		padding: var(--space-card);
		box-shadow: var(--shadow-sm);
		overflow: hidden;
		text-decoration: none;
		display: block;
		color: inherit;
		transition: all var(--duration-fast) var(--ease-smooth);
	}

	.card.clickable {
		cursor: pointer;
	}

	@media (hover: hover) {
		.card.clickable:hover {
			box-shadow: var(--shadow-md), var(--glow-hover);
			transform: translateY(-2px);
		}
	}

	.card-label {
		display: block;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
	}

	.card-sub {
		display: block;
		font-size: 0.7rem;
		color: var(--text-secondary);
		margin-top: 0.25rem;
	}

	.section-title {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-secondary);
		margin: 1.5rem 0 0.75rem;
	}

	.card.highlight-green {
		border-color: color-mix(in oklch, var(--accent, #57f287) 40%, transparent);
	}

	@media (max-width: 768px) {
		.pulse-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 480px) {
		.pulse-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
