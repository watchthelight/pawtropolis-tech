<script lang="ts">
	import DataCard from '$lib/components/data/DataCard.svelte';
	import StatNumber from '$lib/components/data/StatNumber.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import { relativeTime } from '$lib/utils/time';

	let { data } = $props();
	let snap = $derived(data.snapshot);

	let roles = $derived(snap.rolesSnapshot as Array<{ id?: string; name?: string; permissions?: string; memberCount?: number; color?: number; position?: number }>);
	let channels = $derived(snap.channelsSnapshot as Array<{ id?: string; name?: string; type?: string; overwrites?: unknown[] }>);
	let issues = $derived(snap.issuesSnapshot as Array<{ severity?: string; title?: string; category?: string; description?: string }>);

	let expandedSection = $state<string | null>(null);
	function toggle(section: string) {
		expandedSection = expandedSection === section ? null : section;
	}

	function severityColor(severity: string | undefined): string {
		switch (severity) {
			case 'critical': return 'var(--status-danger)';
			case 'high': return 'oklch(65% 0.15 40)';
			case 'medium': return 'var(--status-warning)';
			case 'low': return 'var(--status-info)';
			default: return 'var(--text-secondary)';
		}
	}
</script>

<SpringReveal stagger={30}>
	<a href="/dashboard/audit/security" class="back-link">&larr; Back to Security</a>

	<h2 class="snapshot-title">Snapshot #{snap.id}</h2>
	<p class="snapshot-time">{relativeTime(snap.createdAt)}</p>

	<div class="summary-grid">
		<DataCard>
			<StatNumber value={snap.issueCount} label="Issues" />
		</DataCard>
		<DataCard accent={snap.criticalCount > 0}>
			<StatNumber value={snap.criticalCount} label="Critical" />
		</DataCard>
		<DataCard>
			<StatNumber value={snap.highCount} label="High" />
		</DataCard>
		<DataCard>
			<StatNumber value={snap.roleCount} label="Roles" />
		</DataCard>
		<DataCard>
			<StatNumber value={snap.channelCount} label="Channels" />
		</DataCard>
	</div>

	<!-- Issues -->
	<button class="collapsible-header" onclick={() => toggle('issues')}>
		<span class="collapsible-arrow" class:collapsible-open={expandedSection === 'issues'}>&rsaquo;</span>
		Issues ({issues.length})
	</button>
	{#if expandedSection === 'issues'}
		<div class="collapsible-body">
			{#each issues as issue, i (i)}
				<div class="detail-row">
					<span class="severity-badge" style:background={severityColor(issue.severity)}>
						{(issue.severity ?? '?').toUpperCase()}
					</span>
					<div class="detail-content">
						<span class="detail-title">{issue.title ?? 'Untitled'}</span>
						{#if issue.description}
							<span class="detail-desc">{issue.description}</span>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Roles -->
	<button class="collapsible-header" onclick={() => toggle('roles')}>
		<span class="collapsible-arrow" class:collapsible-open={expandedSection === 'roles'}>&rsaquo;</span>
		Roles ({roles.length})
	</button>
	{#if expandedSection === 'roles'}
		<div class="collapsible-body">
			{#each roles as role (role.id ?? role.name)}
				<div class="detail-row">
					<span class="role-name">{role.name ?? 'Unknown'}</span>
					{#if role.memberCount != null}
						<span class="detail-meta">{role.memberCount} members</span>
					{/if}
					<span class="detail-meta">pos {role.position ?? '?'}</span>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Channels -->
	<button class="collapsible-header" onclick={() => toggle('channels')}>
		<span class="collapsible-arrow" class:collapsible-open={expandedSection === 'channels'}>&rsaquo;</span>
		Channels ({channels.length})
	</button>
	{#if expandedSection === 'channels'}
		<div class="collapsible-body">
			{#each channels as ch (ch.id ?? ch.name)}
				<div class="detail-row">
					<span class="detail-title">{ch.name ?? 'Unknown'}</span>
					<span class="detail-meta">{ch.type ?? 'text'}</span>
					{#if ch.overwrites && Array.isArray(ch.overwrites)}
						<span class="detail-meta">{ch.overwrites.length} overwrites</span>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</SpringReveal>

<style>
	.back-link {
		font-size: 0.8rem;
		color: var(--accent);
		text-decoration: none;
		display: inline-block;
		margin-bottom: 1rem;
	}

	.snapshot-title {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--text-primary);
		margin: 0;
	}

	.snapshot-time {
		font-size: 0.75rem;
		color: var(--text-muted);
		margin: 0.25rem 0 1rem;
	}

	.summary-grid {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.collapsible-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.625rem 0.75rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font: inherit;
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
		margin-bottom: 2px;
		transition: background var(--duration-fast);
		text-align: left;
	}

	.collapsible-header:hover {
		background: var(--surface-raised);
	}

	.collapsible-arrow {
		font-size: 1rem;
		transition: transform 200ms;
		display: inline-block;
	}

	.collapsible-open {
		transform: rotate(90deg);
	}

	.collapsible-body {
		padding: 0.5rem 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-bottom: 0.5rem;
	}

	.detail-row {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.35rem 0.75rem 0.35rem 1.75rem;
		font-size: 0.8rem;
	}

	.severity-badge {
		font-size: 0.5rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		padding: 0.1rem 0.3rem;
		border-radius: 3px;
		color: var(--bg);
		flex-shrink: 0;
		margin-top: 0.15rem;
	}

	.detail-content {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.detail-title {
		color: var(--text-primary);
	}

	.detail-desc {
		font-size: 0.7rem;
		color: var(--text-secondary);
		line-height: 1.4;
	}

	.role-name {
		color: var(--text-primary);
		font-weight: 500;
	}

	.detail-meta {
		font-size: 0.7rem;
		color: var(--text-muted);
		margin-left: auto;
		flex-shrink: 0;
	}

	@media (max-width: 768px) {
		.summary-grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}

	@media (max-width: 480px) {
		.summary-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
