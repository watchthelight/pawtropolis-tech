<script lang="ts">
	type TabId = 'unclaimed' | 'mine' | 'all' | 'history';

	let { active, counts, onchange }: {
		active: TabId;
		counts: Record<TabId, number>;
		onchange: (tab: TabId) => void;
	} = $props();

	const TABS: { id: TabId; label: string }[] = [
		{ id: 'unclaimed', label: 'Unclaimed' },
		{ id: 'mine', label: 'My Claims' },
		{ id: 'all', label: 'All Open' },
		{ id: 'history', label: 'History' }
	];
</script>

<div class="tab-bar" role="tablist">
	{#each TABS as tab}
		<button
			role="tab"
			aria-selected={active === tab.id}
			class="tab"
			class:tab-active={active === tab.id}
			onclick={() => onchange(tab.id)}
		>
			{tab.label}
			<span class="tab-badge">{counts[tab.id]}</span>
		</button>
	{/each}
</div>

<style>
	.tab-bar {
		display: flex;
		gap: 0.25rem;
		padding-bottom: 0.5rem;
		margin-bottom: 0.5rem;
		border-bottom: 1px solid var(--line);
	}

	.tab {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.375rem 0.75rem;
		border: 1px solid transparent;
		border-radius: var(--radius);
		background: transparent;
		color: var(--ink-3);
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		transition: color 150ms var(--ease-smooth), border-color 150ms var(--ease-smooth);
	}

	@media (hover: hover) {
		.tab:hover {
			color: var(--ink);
		}
	}

	.tab-active {
		color: var(--sage);
		background: var(--sage-fill);
		border-color: var(--sage-soft);
	}

	.tab-badge {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		padding: 0.1rem 0.375rem;
		border-radius: var(--radius);
		background: var(--surface-2);
		color: var(--ink-3);
		min-width: 1.25rem;
		text-align: center;
	}

	.tab-active .tab-badge {
		background: var(--sage);
		color: var(--on-sage);
	}

	@media (max-width: 767px) {
		.tab-bar {
			gap: 0.375rem;
			padding: 0.25rem;
			margin-bottom: 0.75rem;
			background: var(--surface);
			border-radius: var(--radius-md);
			border: 1px solid var(--border-holdfast);
			border-bottom: none;
		}
		.tab {
			flex: 1;
			justify-content: center;
			flex-shrink: 0;
			min-height: 44px;
			padding: 0.5rem 0.25rem;
			font-size: 0.75rem;
		}
		.tab-active {
			background: var(--surface-raised);
			box-shadow: var(--shadow-sm);
		}
	}
</style>
