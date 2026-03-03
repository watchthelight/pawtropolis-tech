<script lang="ts">
	import { page } from '$app/stores';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import DataCard from '$lib/components/data/DataCard.svelte';
	import StatNumber from '$lib/components/data/StatNumber.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import { formatDuration } from '$lib/utils/time';

	let { data } = $props();
	let personal = $derived(data.personal);

	type TabId = 'mine' | 'team';
	const VALID_TABS: TabId[] = ['mine', 'team'];
	const urlTab = $page.url.searchParams.get('tab');
	let activeTab = $state<TabId>(
		urlTab && VALID_TABS.includes(urlTab as TabId) ? (urlTab as TabId) : 'mine'
	);

	let hasData = $derived(personal.total > 0);
</script>

<SpringReveal stagger={30}>
	<PageHeader title="Stats" subtitle="Your review performance" />

	<!-- Tab bar -->
	<div class="mb-6 flex gap-1 rounded-lg bg-[var(--surface)] p-1" role="tablist">
		<button
			role="tab"
			aria-selected={activeTab === 'mine'}
			class="tab-btn"
			class:tab-active={activeTab === 'mine'}
			onclick={() => (activeTab = 'mine')}
		>
			My Stats
		</button>
		<button
			role="tab"
			aria-selected={activeTab === 'team'}
			class="tab-btn"
			class:tab-active={activeTab === 'team'}
			onclick={() => (activeTab = 'team')}
		>
			Team
		</button>
	</div>

	{#if activeTab === 'mine'}
		{#if hasData}
			<!-- Decision counts -->
			<div class="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
				<DataCard>
					<StatNumber value={personal.total} label="Decisions" />
				</DataCard>
				<DataCard>
					<StatNumber value={personal.approvals} label="Approvals" />
				</DataCard>
				<DataCard>
					<StatNumber value={personal.rejections + personal.permRejects} label="Rejections" />
				</DataCard>
				<DataCard>
					<StatNumber value={personal.kicks} label="Kicks" />
				</DataCard>
			</div>

			<!-- Response times -->
			<div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
				<DataCard>
					<div class="flex flex-col gap-1">
						<span class="text-2xl font-bold text-[var(--text-primary)]">
							{formatDuration(personal.avgClaimToDecisionS)}
						</span>
						<span class="text-sm text-[var(--text-secondary)]">Avg claim to decision</span>
					</div>
				</DataCard>
				<DataCard>
					<div class="flex flex-col gap-1">
						<span class="text-2xl font-bold text-[var(--text-primary)]">
							{formatDuration(personal.avgSubmitToClaimS)}
						</span>
						<span class="text-sm text-[var(--text-secondary)]">Avg submit to first claim (server)</span>
					</div>
				</DataCard>
			</div>

			<!-- Breakdown detail -->
			{#if personal.modmail > 0 || personal.permRejects > 0}
				<DataCard>
					<div class="flex flex-wrap gap-x-6 gap-y-2 text-sm text-[var(--text-secondary)]">
						{#if personal.permRejects > 0}
							<span>{personal.permRejects} perm reject{personal.permRejects !== 1 ? 's' : ''}</span>
						{/if}
						{#if personal.modmail > 0}
							<span>{personal.modmail} modmail{personal.modmail !== 1 ? 's' : ''} opened</span>
						{/if}
					</div>
				</DataCard>
			{/if}

			<p class="mt-4 text-xs text-[var(--text-secondary)]">
				Showing last {data.windowDays} days
			</p>
		{:else}
			<EmptyState
				message="Not enough data yet"
				subtitle="Start reviewing applications to see your stats here."
			/>
		{/if}
	{:else}
		<EmptyState
			message="Team stats coming soon"
			subtitle="Team performance view will be available in a future update."
		/>
	{/if}
</SpringReveal>

<style>
	.tab-btn {
		flex: 1;
		padding: 0.5rem 1rem;
		border-radius: 0.375rem;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-secondary);
		background: transparent;
		border: none;
		cursor: pointer;
		transition: all 150ms ease;
	}

	.tab-btn:hover {
		color: var(--text-primary);
	}

	.tab-active {
		background: var(--surface-raised);
		color: var(--text-primary);
		box-shadow: var(--shadow-sm);
	}
</style>
