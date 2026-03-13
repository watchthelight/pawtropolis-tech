<script lang="ts">
	import { onDestroy } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import StatNumber from '$lib/components/data/StatNumber.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import { subscribe, unsubscribe, onReconnect, offReconnect } from '$lib/stores/sse.svelte';
	import { ClipboardList, Mail, Flag, CheckCircle, Users, UserCheck, Bot, Zap, MessageSquare } from 'lucide-svelte';
	import { relativeTime } from '$lib/utils/time';

	let { data } = $props();
	let metrics = $derived(data.metrics);
	let pendingTrend = $derived<'up' | 'down' | undefined>(
		metrics.submittedToday === 0 && metrics.decisionsToday === 0
			? undefined
			: metrics.submittedToday > metrics.decisionsToday
				? 'up'
				: metrics.decisionsToday > metrics.submittedToday
					? 'down'
					: undefined
	);
	let modmailPreview = $derived(
		metrics.latestModmailAt ? `latest: ${relativeTime(new Date(metrics.latestModmailAt).getTime())}` : null
	);
	let totalFlags = $derived(metrics.activeFlags + metrics.behavioralFlags);
	let flagBreakdown = $derived.by(() => {
		const parts: string[] = [];
		if (metrics.activeFlags > 0) parts.push(`${metrics.activeFlags} avatar`);
		if (metrics.behavioralFlags > 0) parts.push(`${metrics.behavioralFlags} behavioral`);
		return parts.join(' \u00b7 ');
	});
	let activityTrend = $derived<'up' | 'down' | undefined>(
		metrics.messagesToday === 0 || metrics.messagesAvg7d === 0
			? undefined
			: metrics.messagesToday > metrics.messagesAvg7d * 1.2
				? 'up'
				: metrics.messagesToday < metrics.messagesAvg7d * 0.8
					? 'down'
					: undefined
	);
	let maxHour = $derived(Math.max(...metrics.hourlyDistribution, 1));

	// Live pulse updates — review/modmail/flag events refresh metrics (debounced)
	let invalidateTimer: ReturnType<typeof setTimeout> | undefined;
	function onPulseEvent() {
		if (invalidateTimer) clearTimeout(invalidateTimer);
		invalidateTimer = setTimeout(() => invalidateAll(), 150);
	}
	function onSSEReconnect() { invalidateAll(); }

	subscribe('review:*', onPulseEvent);
	subscribe('modmail:*', onPulseEvent);
	subscribe('flag:*', onPulseEvent);
	onReconnect(onSSEReconnect);

	onDestroy(() => {
		unsubscribe('review:*', onPulseEvent);
		unsubscribe('modmail:*', onPulseEvent);
		unsubscribe('flag:*', onPulseEvent);
		offReconnect(onSSEReconnect);
		if (invalidateTimer) clearTimeout(invalidateTimer);
	});
</script>

<SpringReveal stagger={30}>
	<PageHeader title="Pulse" subtitle="Server overview at a glance" />

	<div class="pulse-grid">
		<a href="/dashboard/reviews" class="card clickable" class:card-accent={metrics.pendingApps > 0}>
			<div class="card-icon-row">
				<ClipboardList size={16} color={metrics.pendingApps > 0 ? 'var(--accent)' : 'var(--text-tertiary)'} />
				<span class="status-dot" class:status-green={metrics.pendingApps === 0} class:status-amber={metrics.pendingApps > 0}></span>
			</div>
			<span class="card-label">Pending Applications</span>
			<StatNumber value={metrics.pendingApps} label="" trend={pendingTrend} invertColors={true} />
			<span class="card-sub">{metrics.pendingApps === 0 ? 'All clear' : 'in the queue'}</span>
		</a>

		<div class="card" class:card-accent={metrics.openModmail > 0}>
			<div class="card-icon-row">
				<Mail size={16} color={metrics.openModmail > 0 ? 'var(--accent)' : 'var(--text-tertiary)'} />
				<span class="status-dot" class:status-green={metrics.openModmail === 0} class:status-amber={metrics.openModmail > 0}></span>
			</div>
			<span class="card-label">Open Modmail</span>
			<StatNumber value={metrics.openModmail} label="" />
			<span class="card-sub">{metrics.openModmail === 0 ? 'No open threads' : modmailPreview ?? 'active threads'}</span>
		</div>

		<a href="/dashboard/flags" class="card clickable" class:card-accent={totalFlags > 0}>
			<div class="card-icon-row">
				<Flag size={16} color={totalFlags > 0 ? 'var(--accent)' : 'var(--text-tertiary)'} />
				<span class="status-dot" class:status-green={totalFlags === 0} class:status-amber={totalFlags > 0}></span>
			</div>
			<span class="card-label">Active Flags</span>
			<StatNumber value={totalFlags} label="" />
			<span class="card-sub">{totalFlags === 0 ? 'No active flags' : flagBreakdown}</span>
		</a>

		<div class="card">
			<div class="card-icon-row">
				<CheckCircle size={16} color="var(--text-tertiary)" />
			</div>
			<span class="card-label">Decisions Today</span>
			<StatNumber value={metrics.decisionsToday} label="" />
			<span class="card-sub">{metrics.decisionsToday === 0 ? 'No decisions yet' : 'team actions today'}</span>
		</div>

		<div class="card" class:card-accent={activityTrend !== undefined}>
			<div class="card-icon-row">
				<MessageSquare size={16} color={activityTrend !== undefined ? 'var(--accent)' : 'var(--text-tertiary)'} />
				<span class="status-dot" class:status-green={activityTrend === undefined} class:status-amber={activityTrend !== undefined}></span>
			</div>
			<span class="card-label">Activity Today</span>
			<StatNumber value={metrics.messagesToday} label="" trend={activityTrend} />
			{#if metrics.messagesToday > 0}
				<svg class="hourly-bars" viewBox="0 0 96 32" preserveAspectRatio="none" aria-hidden="true">
					{#each metrics.hourlyDistribution as count, i}
						<rect
							x={i * 4}
							y={32 - (count / maxHour) * 32}
							width="3"
							height={(count / maxHour) * 32}
							fill="var(--accent)"
							opacity="0.7"
						/>
					{/each}
				</svg>
			{/if}
			<span class="card-sub">{metrics.messagesToday === 0 ? 'No activity data' : `avg: ${metrics.messagesAvg7d}/day`}</span>
		</div>
	</div>

	<h3 class="section-title">Membership</h3>
	<div class="pulse-grid">
		<div class="card">
			<div class="card-icon-row">
				<Users size={16} color="var(--text-tertiary)" />
			</div>
			<span class="card-label">Total Tracked</span>
			<StatNumber value={metrics.totalMembers} label="" />
			<span class="card-sub">members in database</span>
		</div>

		<div class="card highlight-accent">
			<div class="card-icon-row">
				<UserCheck size={16} color="var(--accent)" />
			</div>
			<span class="card-label">Estimated Real Users</span>
			<StatNumber value={metrics.estimatedRealUsers} label="" />
			<span class="card-sub">members with activity</span>
		</div>

		<div class="card">
			<div class="card-icon-row">
				<Bot size={16} color="var(--text-tertiary)" />
			</div>
			<span class="card-label">Estimated Bots</span>
			<StatNumber value={metrics.estimatedBots} label="" />
			<span class="card-sub">no messages or activity</span>
		</div>

		<div class="card highlight-accent">
			<div class="card-icon-row">
				<Zap size={16} color="var(--accent)" />
			</div>
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
		background-image: linear-gradient(180deg, oklch(100% 0 0 / 0.03) 0%, transparent 50%);
		border: 1px solid color-mix(in oklch, var(--accent) 15%, var(--border-holdfast));
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
			box-shadow: var(--shadow-md), var(--glow-accent);
			transform: translateY(-2px);
		}
	}

	.card-accent {
		background: var(--accent-glow-bg);
		border-top: 3px solid var(--accent);
		border-color: color-mix(in oklch, var(--accent) 30%, var(--border-holdfast));
		border-top-color: var(--accent);
	}

	.card-icon-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
	}

	.status-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}

	.status-green {
		background: var(--status-success);
		box-shadow: 0 0 6px var(--status-success);
	}

	.status-amber {
		background: var(--status-warning);
		box-shadow: 0 0 6px var(--status-warning);
	}

	.card-label {
		display: block;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--accent-muted);
		margin-bottom: 0.5rem;
	}

	.card-sub {
		display: block;
		font-size: 0.7rem;
		color: var(--text-secondary);
		margin-top: 0.25rem;
	}

	.section-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-secondary);
		margin: 1.5rem 0 0.75rem;
	}

	.section-title::before {
		content: '';
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--accent);
		flex-shrink: 0;
	}

	.hourly-bars {
		width: 100%;
		height: 32px;
		margin-top: 0.25rem;
		display: block;
	}

	.card.highlight-accent {
		border-color: color-mix(in oklch, var(--accent) 40%, transparent);
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
