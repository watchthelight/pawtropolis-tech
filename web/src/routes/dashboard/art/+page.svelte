<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import { relativeTime } from '$lib/utils/time';

	let { data } = $props();
	let queue = $derived(data.queue);
	let jobs = $derived(data.jobs);

	// Next-up = first non-skipped artist
	let nextUpUserId = $derived(queue.find((a) => !a.skipped)?.userId ?? null);

	type TabId = 'queue' | 'jobs';
	let activeTab = $state<TabId>('queue');

	const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
		assigned: { bg: 'var(--accent-dim)', text: 'var(--accent)' },
		sketching: { bg: 'oklch(30% 0.08 220)', text: 'oklch(75% 0.12 220)' },
		lining: { bg: 'oklch(30% 0.08 280)', text: 'oklch(75% 0.12 280)' },
		coloring: { bg: 'oklch(30% 0.08 330)', text: 'oklch(75% 0.12 330)' },
		done: { bg: 'oklch(25% 0.06 145)', text: 'var(--status-success)' },
		cancelled: { bg: 'oklch(25% 0.04 0)', text: 'var(--text-secondary)' }
	};

	function ticketLabel(type: string): string {
		switch (type) {
			case 'headshot': return 'Headshot';
			case 'halfbody': return 'Half Body';
			case 'fullbody': return 'Full Body';
			case 'emoji': return 'Emoji';
			default: return type;
		}
	}
</script>

<SpringReveal stagger={30}>
	<div class="header">
		<div>
			<PageHeader title="Art" subtitle="Artist queue and assignments" />
		</div>
		<div class="tab-bar" role="tablist">
			<button
				role="tab"
				aria-selected={activeTab === 'queue'}
				class="tab"
				class:tab-active={activeTab === 'queue'}
				onclick={() => activeTab = 'queue'}
			>
				Queue
				{#if queue.length > 0}
					<span class="tab-count">{queue.length}</span>
				{/if}
			</button>
			<button
				role="tab"
				aria-selected={activeTab === 'jobs'}
				class="tab"
				class:tab-active={activeTab === 'jobs'}
				onclick={() => activeTab = 'jobs'}
			>
				Active Jobs
				{#if jobs.length > 0}
					<span class="tab-count">{jobs.length}</span>
				{/if}
			</button>
		</div>
	</div>

	{#if activeTab === 'queue'}
		{#if queue.length === 0}
			<EmptyState
				message="No artists in queue"
				subtitle="The artist rotation queue is empty."
			/>
		{:else}
			<div class="table-card">
				<div class="table-header">
					<span class="col-pos">#</span>
					<span class="col-name">Artist</span>
					<span class="col-count">Jobs</span>
					<span class="col-time">Last Assigned</span>
					<span class="col-status">Status</span>
				</div>
				{#each queue as artist (artist.userId)}
					<div
						class="table-row"
						class:row-next-up={artist.userId === nextUpUserId}
						class:row-skipped={artist.skipped}
					>
						<span class="col-pos">{artist.position}</span>
						<span class="col-name">
							{artist.displayName}
							{#if artist.userId === nextUpUserId}
								<span class="next-badge">Next</span>
							{/if}
						</span>
						<span class="col-count">{artist.assignmentsCount}</span>
						<span class="col-time">
							{artist.lastAssignedAt ? relativeTime(artist.lastAssignedAt) : 'Never'}
						</span>
						<span class="col-status">
							{#if artist.skipped}
								<span class="skip-badge" title={artist.skipReason ?? 'On break'}>
									Skipped
								</span>
								{#if artist.skipReason}
									<span class="skip-reason">{artist.skipReason}</span>
								{/if}
							{:else}
								<span class="active-badge">Active</span>
							{/if}
						</span>
					</div>
				{/each}
			</div>
		{/if}
	{:else}
		{#if jobs.length === 0}
			<EmptyState
				message="No active jobs"
				subtitle="All art jobs are completed or cancelled."
			/>
		{:else}
			<div class="table-card">
				<div class="table-header jobs-header">
					<span class="col-job">#</span>
					<span class="col-name">Artist</span>
					<span class="col-name">Recipient</span>
					<span class="col-type">Type</span>
					<span class="col-job-status">Status</span>
					<span class="col-time">Assigned</span>
				</div>
				{#each jobs as job (job.id)}
					{@const colors = STATUS_COLORS[job.status] ?? STATUS_COLORS.assigned}
					<div class="table-row">
						<span class="col-job job-number">#{job.jobNumber}</span>
						<span class="col-name">{job.artistName}</span>
						<span class="col-name">{job.recipientName}</span>
						<span class="col-type">
							<span class="type-badge">{ticketLabel(job.ticketType)}</span>
						</span>
						<span class="col-job-status">
							<span
								class="status-badge"
								style:background={colors.bg}
								style:color={colors.text}
							>
								{job.status}
							</span>
						</span>
						<span class="col-time">{relativeTime(job.assignedAt)}</span>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</SpringReveal>

<style>
	/* ─── Header ─── */
	.header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	/* ─── Tabs ─── */
	.tab-bar {
		display: flex;
		gap: 0.25rem;
	}

	.tab {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.75rem;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-secondary);
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 150ms var(--ease-smooth);
	}

	@media (hover: hover) {
		.tab:hover {
			color: var(--text-primary);
			background: var(--surface-raised);
		}
	}

	.tab:active {
		background: var(--surface-raised);
	}

	.tab-active {
		color: var(--text-primary);
		background: var(--surface);
		box-shadow: var(--glow-accent);
	}

	.tab-count {
		font-size: 0.65rem;
		font-weight: 600;
		padding: 0.1rem 0.35rem;
		border-radius: var(--radius-sm);
		background: var(--accent-dim);
		color: var(--accent);
		font-variant-numeric: tabular-nums;
	}

	/* ─── Table card ─── */
	.table-card {
		background: var(--surface);
		border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.table-header {
		display: flex;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		border-bottom: 1px solid var(--border-holdfast);
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-secondary);
	}

	.table-row {
		display: flex;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		border-bottom: 1px solid var(--border);
		font-size: 0.85rem;
		color: var(--text-primary);
		align-items: center;
		transition: background 150ms var(--ease-smooth);
	}

	.table-row:last-child {
		border-bottom: none;
	}

	@media (hover: hover) {
		.table-row:hover {
			background: var(--surface-raised);
		}
	}

	/* ─── Queue columns ─── */
	.col-pos {
		width: 2.5rem;
		flex-shrink: 0;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--text-secondary);
	}

	.col-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.col-count {
		width: 3.5rem;
		flex-shrink: 0;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.col-time {
		width: 7rem;
		flex-shrink: 0;
		text-align: right;
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	.col-status {
		width: 7rem;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	/* ─── Jobs columns ─── */
	.col-job {
		width: 3.5rem;
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
	}

	.job-number {
		font-weight: 600;
		color: var(--text-secondary);
	}

	.col-type {
		width: 5.5rem;
		flex-shrink: 0;
	}

	.col-job-status {
		width: 5.5rem;
		flex-shrink: 0;
	}

	/* ─── Next-up row ─── */
	.row-next-up {
		background: var(--accent-dim);
		border-left: 3px solid var(--accent);
	}

	.next-badge {
		font-size: 0.6rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 0.1rem 0.35rem;
		border-radius: var(--radius-sm);
		background: var(--accent-dim);
		color: var(--accent);
		flex-shrink: 0;
	}

	/* ─── Skipped row ─── */
	.row-skipped {
		opacity: 0.55;
	}

	.skip-badge {
		font-size: 0.65rem;
		font-weight: 600;
		padding: 0.1rem 0.35rem;
		border-radius: var(--radius-sm);
		background: oklch(25% 0.04 0);
		color: var(--text-secondary);
	}

	.skip-reason {
		font-size: 0.65rem;
		color: var(--text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.active-badge {
		font-size: 0.65rem;
		font-weight: 600;
		padding: 0.1rem 0.35rem;
		border-radius: var(--radius-sm);
		background: oklch(25% 0.06 145);
		color: var(--status-success);
	}

	/* ─── Badges ─── */
	.type-badge {
		font-size: 0.7rem;
		font-weight: 500;
		padding: 0.125rem 0.375rem;
		border-radius: var(--radius-sm);
		background: var(--surface-raised);
		color: var(--text-secondary);
		border: 1px solid var(--border);
	}

	.status-badge {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: capitalize;
		padding: 0.125rem 0.375rem;
		border-radius: var(--radius-sm);
	}

	/* ─── Mobile ─── */
	@media (max-width: 768px) {
		.header {
			flex-direction: column;
		}

		.col-time {
			display: none;
		}

		.col-count {
			width: 2.5rem;
		}

		.jobs-header .col-name:nth-child(3),
		.table-row .col-name:nth-child(3) {
			display: none;
		}

		.tab {
			min-height: 44px;
		}
	}

	@media (max-width: 480px) {
		.col-status {
			width: auto;
		}

		.col-type {
			display: none;
		}
	}
</style>
