<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import DataCard from '$lib/components/data/DataCard.svelte';
	import StatNumber from '$lib/components/data/StatNumber.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import { relativeTime } from '$lib/utils/time';

	let { data } = $props();
	let stats = $derived(data.stats);
	let recent = $derived(data.recent);

	const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
		pending:  { bg: 'oklch(25% 0.06 60)',  text: 'oklch(75% 0.12 60)' },
		approved: { bg: 'oklch(25% 0.06 145)', text: 'var(--status-success)' },
		rejected: { bg: 'oklch(25% 0.04 0)',   text: 'var(--status-danger)' },
		used:     { bg: 'var(--accent-dim)',    text: 'var(--accent)' }
	};

	function statusLabel(status: string): string {
		return status.charAt(0).toUpperCase() + status.slice(1);
	}

	function truncate(text: string, max: number): string {
		return text.length > max ? text.slice(0, max) + '...' : text;
	}
</script>

<SpringReveal stagger={30}>
	<PageHeader title="QOTD" subtitle="Question of the Day suggestions" />

	<!-- Stats grid -->
	<div class="metrics-grid">
		<DataCard accent>
			<StatNumber value={stats.pending} label="Pending Review" />
		</DataCard>
		<DataCard>
			<StatNumber value={stats.approved} label="Approved (Ready)" />
		</DataCard>
		<DataCard>
			<StatNumber value={stats.used} label="Used" />
		</DataCard>
		<DataCard>
			<StatNumber value={stats.rejected} label="Rejected" />
		</DataCard>
	</div>

	<!-- Recent suggestions -->
	<h2 class="section-heading">Recent Suggestions</h2>

	{#if recent.length === 0}
		<EmptyState message="No suggestions yet" subtitle="Members can submit QOTD ideas with /qotd suggest" />
	{:else}
		<div class="suggestion-list">
			{#each recent as s (s.id)}
				<div class="suggestion-row">
					<div class="suggestion-main">
						<span class="suggestion-question">{truncate(s.question, 120)}</span>
						<span class="suggestion-meta">
							#{s.shortCode} &middot; <code>{s.userId}</code> &middot; {relativeTime(s.createdAtS * 1000)}
						</span>
					</div>
					<span
						class="status-badge"
						style:background={STATUS_COLORS[s.status]?.bg ?? 'var(--surface)'}
						style:color={STATUS_COLORS[s.status]?.text ?? 'var(--text-secondary)'}
					>
						{statusLabel(s.status)}
					</span>
				</div>
			{/each}
		</div>
	{/if}
</SpringReveal>

<style>
	.metrics-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.section-heading {
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--text-primary);
		margin: 1.5rem 0 0.75rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--border);
	}

	.suggestion-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.suggestion-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		transition: border-color 0.15s ease;
	}

	.suggestion-row:hover {
		border-color: var(--border-holdfast, var(--border));
	}

	.suggestion-main {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}

	.suggestion-question {
		font-size: 0.875rem;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.suggestion-meta {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.suggestion-meta code {
		font-size: 0.7rem;
		opacity: 0.7;
	}

	.status-badge {
		flex-shrink: 0;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.2rem 0.5rem;
		border-radius: 999px;
	}

	@media (max-width: 768px) {
		.metrics-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
