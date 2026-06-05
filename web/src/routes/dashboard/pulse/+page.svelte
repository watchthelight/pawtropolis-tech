<script lang="ts">
	import { onDestroy } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { navigating } from '$app/stores';
	import PulseSkeleton from '$lib/components/pulse/PulseSkeleton.svelte';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import StatNumber from '$lib/components/data/StatNumber.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import InsightsPanel from '$lib/components/pulse/InsightsPanel.svelte';
	import NewsletterStatsCard from '$lib/components/pulse/NewsletterStatsCard.svelte';
	import TimeWindowSelector from '$lib/components/charts/TimeWindowSelector.svelte';
	import { subscribe, unsubscribe, onReconnect, offReconnect } from '$lib/stores/sse.svelte';
	import { ClipboardList, Mail, Flag, CheckCircle, Users, UserCheck, Bot, Zap, MessageSquare, Wifi, Mic, Award } from 'lucide-svelte';
	import { relativeTime } from '$lib/utils/time';

	let { data } = $props();
	let metrics = $derived(data.metrics);
	let insights = $derived(data.insights);
	let newsletterStats = $derived(data.newsletterStats);
	let guildSnapshot = $derived(data.guildSnapshot);
	let topVoiceChannels = $derived(data.topVoiceChannels);
	let channelRanking = $derived(data.channelRanking ?? []);
	let topChannels = $derived(channelRanking.slice(0, 10));
	let bottomChannels = $derived(channelRanking.length > 10 ? channelRanking.slice(-10).reverse() : []);
	let maxChannelMsgs = $derived(topChannels.length > 0 ? topChannels[0].messageCount : 1);
	let levelRoleStats = $derived(data.levelRoleStats);
	let maxRoleCount = $derived(levelRoleStats ? Math.max(...levelRoleStats.roles.map((r: { count: number }) => r.count), 1) : 1);
	let engagement = $derived(data.engagement);
	let windowLabel = $derived(data.windowLabel);

	function pctDelta(cur: number, prev: number | null): 'up' | 'down' | undefined {
		if (prev == null || prev === 0) return undefined;
		const diff = (cur - prev) / prev;
		if (diff > 0.05) return 'up';
		if (diff < -0.05) return 'down';
		return undefined;
	}
	function formatDeltaLabel(cur: number, prev: number | null): string {
		if (prev == null) return '';
		if (prev === 0 && cur === 0) return '';
		if (prev === 0) return 'new activity';
		const diff = ((cur - prev) / prev) * 100;
		const sign = diff >= 0 ? '+' : '';
		return `${sign}${diff.toFixed(0)}% vs prev`;
	}
	let pendingTrend = $derived<'up' | 'down' | undefined>(
		metrics.submittedInWindow === 0 && metrics.decisionsInWindow === 0
			? undefined
			: metrics.submittedInWindow > metrics.decisionsInWindow
				? 'up'
				: metrics.decisionsInWindow > metrics.submittedInWindow
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
	// Compare current per-day rate vs prior-period per-day rate. messagesPrev is window-
	// total over the same span, so dividing both by windowDays cancels out \u2014 equivalent to
	// comparing totals when window lengths match. \u00b120% threshold.
	let activityTrend = $derived.by<'up' | 'down' | undefined>(() => {
		const cur = metrics.messagesInWindow;
		const prev = engagement.messagesPrev;
		if (cur === 0 || prev == null || prev === 0) return undefined;
		if (cur > prev * 1.2) return 'up';
		if (cur < prev * 0.8) return 'down';
		return undefined;
	});
	let useDailyBars = $derived(metrics.windowDays > 1);
	let barData = $derived(useDailyBars ? metrics.dailyDistribution : metrics.hourlyDistribution);
	let maxBar = $derived(Math.max(...barData, 1));
	let barLabel = $derived(useDailyBars ? `${metrics.windowDays}-day breakdown` : 'last 24h');

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

{#if $navigating?.to?.url.pathname?.startsWith('/dashboard/pulse') && $navigating?.from?.url.pathname !== $navigating?.to?.url.pathname}
	<PulseSkeleton />
{:else}
<SpringReveal stagger={30}>
	<div class="pulse-header">
		<PageHeader title="Pulse" subtitle="Server overview at a glance" />
		<TimeWindowSelector value={data.spec} />
	</div>

	<h3 class="section-title">Status now</h3>
	<div class="pulse-grid">
		<a href="/dashboard/reviews" class="card clickable" class:card-accent={metrics.pendingApps > 0}>
			<div class="card-icon-row">
				<ClipboardList size={16} color={metrics.pendingApps > 0 ? 'var(--sage)' : 'var(--ink-3)'} />
				<span class="status-dot" class:status-green={metrics.pendingApps === 0} class:status-amber={metrics.pendingApps > 0}></span>
			</div>
			<span class="card-label">Pending Applications</span>
			<StatNumber value={metrics.pendingApps} label="" trend={pendingTrend} invertColors={true} />
			<span class="card-sub">{metrics.pendingApps === 0 ? 'All clear' : 'in the queue'}</span>
		</a>

		<div class="card" class:card-accent={metrics.openModmail > 0}>
			<div class="card-icon-row">
				<Mail size={16} color={metrics.openModmail > 0 ? 'var(--sage)' : 'var(--ink-3)'} />
				<span class="status-dot" class:status-green={metrics.openModmail === 0} class:status-amber={metrics.openModmail > 0}></span>
			</div>
			<span class="card-label">Open Modmail</span>
			<StatNumber value={metrics.openModmail} label="" />
			<span class="card-sub">{metrics.openModmail === 0 ? 'No open threads' : modmailPreview ?? 'active threads'}</span>
		</div>

		<a href="/dashboard/flags" class="card clickable" class:card-accent={totalFlags > 0}>
			<div class="card-icon-row">
				<Flag size={16} color={totalFlags > 0 ? 'var(--sage)' : 'var(--ink-3)'} />
				<span class="status-dot" class:status-green={totalFlags === 0} class:status-amber={totalFlags > 0}></span>
			</div>
			<span class="card-label">Active Flags</span>
			<StatNumber value={totalFlags} label="" />
			<span class="card-sub">{totalFlags === 0 ? 'No active flags' : flagBreakdown}</span>
		</a>
	</div>

	<h3 class="section-title">Activity ({windowLabel})</h3>
	<div class="pulse-grid">
		<div class="card">
			<div class="card-icon-row">
				<CheckCircle size={16} color="var(--ink-3)" />
			</div>
			<span class="card-label">Decisions</span>
			<StatNumber value={metrics.decisionsInWindow} label="" />
			<span class="card-sub">{metrics.decisionsInWindow === 0 ? 'No decisions in window' : 'team actions in window'}</span>
		</div>

		<div class="card">
			<div class="card-icon-row">
				<UserCheck size={16} color="var(--ink-3)" />
			</div>
			<span class="card-label">Approvals</span>
			<StatNumber value={metrics.approvalsInWindow} label="" />
			<span class="card-sub">{metrics.approvalsInWindow === 0 ? 'No approvals yet' : 'members verified in window'}</span>
		</div>

		<div class="card" class:card-accent={activityTrend !== undefined}>
			<div class="card-icon-row">
				<MessageSquare size={16} color={activityTrend !== undefined ? 'var(--sage)' : 'var(--ink-3)'} />
				<span class="status-dot" class:status-green={activityTrend === undefined} class:status-amber={activityTrend !== undefined}></span>
			</div>
			<span class="card-label">Messages</span>
			<StatNumber value={metrics.messagesInWindow} label="" trend={activityTrend} />
			{#if metrics.messagesInWindow > 0}
				<svg class="activity-bars" viewBox="0 0 96 32" preserveAspectRatio="none" aria-hidden="true" aria-label={barLabel}>
					{#each barData as count, i}
						<rect
							x={i * (96 / barData.length)}
							y={32 - (count / maxBar) * 32}
							width={Math.max(1, (96 / barData.length) - 1)}
							height={(count / maxBar) * 32}
							fill="var(--sage)"
							opacity="0.7"
						/>
					{/each}
				</svg>
			{/if}
			<span class="card-sub">{metrics.messagesInWindow === 0 ? 'No activity data' : `avg: ${metrics.messagesAvgPerDay.toLocaleString()}/day · ${barLabel}`}</span>
		</div>
	</div>

	<h3 class="section-title">Insights</h3>
	<InsightsPanel {insights} />

	<h3 class="section-title">Engagement ({windowLabel})</h3>
	<div class="pulse-grid">
		<div class="card">
			<div class="card-icon-row">
				<MessageSquare size={16} color="var(--ink-3)" />
			</div>
			<span class="card-label">Messages</span>
			<StatNumber value={engagement.messages} label="" trend={pctDelta(engagement.messages, engagement.messagesPrev)} />
			<span class="card-sub">{formatDeltaLabel(engagement.messages, engagement.messagesPrev) || 'messages in window'}</span>
		</div>

		<div class="card">
			<div class="card-icon-row">
				<UserCheck size={16} color="var(--ink-3)" />
			</div>
			<span class="card-label">Communicators</span>
			<StatNumber value={engagement.communicators} label="" trend={pctDelta(engagement.communicators, engagement.communicatorsPrev)} />
			<span class="card-sub">{formatDeltaLabel(engagement.communicators, engagement.communicatorsPrev) || 'distinct senders'}</span>
		</div>

		<div class="card">
			<div class="card-icon-row">
				<Mic size={16} color="var(--ink-3)" />
			</div>
			<span class="card-label">Voice Minutes</span>
			<StatNumber value={engagement.voiceMinutes} label="" trend={pctDelta(engagement.voiceMinutes, engagement.voiceMinutesPrev)} />
			<span class="card-sub">{formatDeltaLabel(engagement.voiceMinutes, engagement.voiceMinutesPrev) || 'voice activity'}</span>
		</div>

		<div class="card">
			<div class="card-icon-row">
				<Users size={16} color="var(--ink-3)" />
			</div>
			<span class="card-label">New Members</span>
			<StatNumber value={engagement.newMembers} label="" trend={pctDelta(engagement.newMembers, engagement.newMembersPrev)} />
			<span class="card-sub">{engagement.membersLeft > 0 ? `${engagement.membersLeft} left` : 'joins in window'}</span>
		</div>

		<div class="card">
			<div class="card-icon-row">
				<Zap size={16} color="var(--ink-3)" />
			</div>
			<span class="card-label">Retention</span>
			<StatNumber value={Math.round(engagement.retentionPct)} label="" suffix="%" />
			<span class="card-sub">new members who sent a message</span>
		</div>
	</div>

	<h3 class="section-title">Membership</h3>
	<div class="pulse-grid">
		<a href="/dashboard/audit/scans" class="card clickable">
			<div class="card-icon-row">
				<Users size={16} color="var(--ink-3)" />
			</div>
			<span class="card-label">Total Members</span>
			{#if guildSnapshot}
				<StatNumber value={guildSnapshot.memberCount} label="" />
				<span class="card-sub">tracked: {metrics.allTimeMembers.toLocaleString()} − {metrics.membersLeft.toLocaleString()} left = {metrics.totalMembers.toLocaleString()}</span>
			{:else}
				<StatNumber value={metrics.totalMembers} label="" />
				<span class="card-sub">{metrics.allTimeMembers.toLocaleString()} all time − {metrics.membersLeft.toLocaleString()} left</span>
			{/if}
		</a>

		{#if guildSnapshot?.onlineCount}
			<div class="card">
				<div class="card-icon-row">
					<Wifi size={16} color="var(--good)" />
				</div>
				<span class="card-label">Currently Online</span>
				<StatNumber value={guildSnapshot.onlineCount} label="" />
				<span class="card-sub">live from Discord</span>
			</div>
		{/if}

		{#if guildSnapshot}
			<div class="card">
				<div class="card-icon-row">
					<Mic size={16} color="var(--sage)" />
				</div>
				<span class="card-label">In Voice Now</span>
				<StatNumber value={guildSnapshot.voiceUsersNow} label="" />
				<span class="card-sub">{guildSnapshot.voiceUsersNow === 0 ? 'no one in voice' : 'connected to voice'}</span>
			</div>
		{/if}

		{#if guildSnapshot}
			<div class="card">
				<div class="card-icon-row">
					<Award size={16} color="var(--secondary)" />
				</div>
				<span class="card-label">Boost Status</span>
				<StatNumber value={guildSnapshot.boostCount} label="" />
				<span class="card-sub">Level {guildSnapshot.boostTier}</span>
			</div>
		{/if}

		<a href="/dashboard/audit/scans" class="card clickable">
			<div class="card-icon-row">
				<UserCheck size={16} color="var(--sage)" />
			</div>
			<span class="card-label">Estimated Real Users</span>
			<StatNumber value={metrics.estimatedRealUsers} label="" />
			<span class="card-sub">members with activity</span>
		</a>

		<a href="/dashboard/audit/scans" class="card clickable">
			<div class="card-icon-row">
				<Bot size={16} color="var(--ink-3)" />
			</div>
			<span class="card-label">Estimated Bots</span>
			<StatNumber value={metrics.estimatedBots} label="" />
			<span class="card-sub">no messages or activity</span>
		</a>

		<a href="/dashboard/audit/scans" class="card clickable">
			<div class="card-icon-row">
				<Zap size={16} color="var(--sage)" />
			</div>
			<span class="card-label">Active Real Users</span>
			<StatNumber value={metrics.activeRealUsers} label="" />
			<span class="card-sub">100+ msgs in last 14 days</span>
		</a>
	</div>

	{#if topChannels.length > 0}
		<h3 class="section-title">Channel Activity ({windowLabel})</h3>
		<div class="channel-ranking-grid">
			<div class="card channel-rank-card">
				<h4 class="rank-heading rank-hot">Most Active</h4>
				<div class="rank-list">
					{#each topChannels as ch, i}
						<div class="rank-row">
							<span class="rank-num">#{i + 1}</span>
							<span class="rank-name">#{ch.channelName}</span>
							<span class="rank-bar-wrap">
								<span class="rank-bar rank-bar-hot" style:width="{Math.max((ch.messageCount / maxChannelMsgs) * 100, 4)}%"></span>
							</span>
							<span class="rank-count">{ch.messageCount.toLocaleString()}</span>
							<span class="rank-users">{ch.uniqueUsers} users</span>
						</div>
					{/each}
				</div>
			</div>
			{#if bottomChannels.length > 0}
				<div class="card channel-rank-card">
					<h4 class="rank-heading rank-cold">Least Active</h4>
					<div class="rank-list">
						{#each bottomChannels as ch, i}
							<div class="rank-row">
								<span class="rank-num">#{channelRanking.length - 9 + i}</span>
								<span class="rank-name">#{ch.channelName}</span>
								<span class="rank-bar-wrap">
									<span class="rank-bar rank-bar-cold" style:width="{Math.max((ch.messageCount / maxChannelMsgs) * 100, 4)}%"></span>
								</span>
								<span class="rank-count">{ch.messageCount.toLocaleString()}</span>
								<span class="rank-users">{ch.uniqueUsers} users</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}

	{#if levelRoleStats && levelRoleStats.roles.length > 0}
		<h3 class="section-title">Level Roles</h3>
		<div class="card level-role-card">
			<table class="level-role-table">
				<thead>
					<tr>
						<th class="col-role">Role</th>
						<th class="col-count">Members</th>
						<th class="col-pct">%</th>
						<th class="col-bar">Distribution</th>
					</tr>
				</thead>
				<tbody>
					{#each levelRoleStats.roles as role}
						{@const pct = levelRoleStats.totalMembers > 0 ? (role.count / levelRoleStats.totalMembers) * 100 : 0}
						<tr>
							<td class="col-role">
								<span class="role-dot" style:background={role.color ?? 'var(--ink-3)'}></span>
								<span class="role-name">{role.roleName}</span>
							</td>
							<td class="col-count">{role.count.toLocaleString()}</td>
							<td class="col-pct">{pct.toFixed(1)}%</td>
							<td class="col-bar">
								<div class="bar-track">
									<div
										class="bar-fill"
										style:width="{(role.count / maxRoleCount) * 100}%"
										style:background={role.color ?? 'var(--sage)'}
									></div>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<span class="card-sub" style="margin-top: 0.75rem;">out of {levelRoleStats.totalMembers.toLocaleString()} total members</span>
		</div>
	{/if}

	<h3 class="section-title">Weekly Newsletter</h3>
	<NewsletterStatsCard stats={newsletterStats} {guildSnapshot} {topVoiceChannels} />
</SpringReveal>
{/if}

<style>
	.pulse-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 0.5rem;
	}

	.pulse-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
	}

	.card {
		background: var(--surface);
		border: 1px solid var(--line-soft);
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
			box-shadow: var(--shadow-md);
			border-color: var(--line);
			transform: translateY(-2px);
		}
	}

	.card-accent {
		border-top: 2px solid var(--sage);
		border-color: oklch(50% 0.04 var(--hue) / 0.3);
		border-top-color: var(--sage);
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
		background: var(--good);
		box-shadow: 0 0 6px var(--good);
	}

	.status-amber {
		background: var(--warn);
		box-shadow: 0 0 6px var(--warn);
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

	.card-breakdown {
		display: block;
		font-size: 0.65rem;
		color: var(--ink-3);
		font-weight: 500;
		letter-spacing: 0.02em;
	}

	.card-sub {
		display: block;
		font-size: 0.7rem;
		color: var(--ink-2);
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
		color: var(--ink-2);
		margin: 1rem 0 0.5rem;
	}

	.section-title::before {
		content: '';
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--sage);
		flex-shrink: 0;
	}

	.activity-bars {
		width: 100%;
		height: 32px;
		margin-top: 0.25rem;
		display: block;
	}


	.level-role-card {
		padding: var(--space-card);
	}

	.level-role-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
	}

	.level-role-table th {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--ink-3);
		text-align: left;
		padding: 0 0.5rem 0.5rem 0;
		border-bottom: 1px solid var(--line-soft);
	}

	.level-role-table td {
		padding: 0.5rem 0.5rem 0.5rem 0;
		border-bottom: 1px solid oklch(50% 0 0 / 0.06);
		vertical-align: middle;
	}

	.level-role-table tbody tr:last-child td {
		border-bottom: none;
	}

	.col-role {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	th.col-role {
		display: table-cell;
	}

	.role-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.role-name {
		font-weight: 500;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.col-count {
		text-align: right;
		font-variant-numeric: tabular-nums;
		color: var(--ink);
		font-weight: 600;
		white-space: nowrap;
		width: 5rem;
	}

	.col-pct {
		text-align: right;
		font-variant-numeric: tabular-nums;
		color: var(--ink-2);
		white-space: nowrap;
		width: 4rem;
	}

	.col-bar {
		width: 40%;
		min-width: 80px;
	}

	.bar-track {
		height: 6px;
		background: oklch(50% 0 0 / 0.08);
		border-radius: 3px;
		overflow: hidden;
	}

	.bar-fill {
		height: 100%;
		border-radius: 3px;
		opacity: 0.8;
		transition: width 0.3s var(--ease-smooth);
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

		.col-bar {
			display: none;
		}

		th.col-bar {
			display: none;
		}

		.channel-ranking-grid {
			grid-template-columns: 1fr;
		}
	}

	/* Channel Activity Ranking */
	.channel-ranking-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}

	.channel-rank-card {
		padding: 1rem;
	}

	.rank-heading {
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.03em;
		margin-bottom: 0.75rem;
	}

	.rank-hot { color: var(--good, #22c55e); }
	.rank-cold { color: var(--ink-3, #666); }

	.rank-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.rank-row {
		display: grid;
		grid-template-columns: 1.5rem 1fr 4rem 2.5rem 3.5rem;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
	}

	.rank-num {
		color: var(--ink-3);
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}

	.rank-name {
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.rank-bar-wrap {
		height: 6px;
		border-radius: 3px;
		background: var(--surface-2, rgba(255,255,255,0.05));
		overflow: hidden;
	}

	.rank-bar {
		display: block;
		height: 100%;
		border-radius: 3px;
		transition: width 0.3s ease;
	}

	.rank-bar-hot { background: var(--good, #22c55e); }
	.rank-bar-cold { background: var(--ink-3, #555); }

	.rank-count {
		text-align: right;
		font-weight: 500;
		color: var(--ink);
		font-variant-numeric: tabular-nums;
	}

	.rank-users {
		text-align: right;
		color: var(--ink-3);
		font-size: 0.65rem;
	}
</style>
