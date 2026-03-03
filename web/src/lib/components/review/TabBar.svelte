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
		padding-bottom: 0.75rem;
		margin-bottom: 0.75rem;
		border-bottom: 1px solid var(--border-holdfast);
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

	.tab-badge {
		font-size: 0.65rem;
		font-weight: 600;
		padding: 0.1rem 0.375rem;
		border-radius: var(--radius-sm);
		background: var(--accent-dim);
		color: var(--accent);
		min-width: 1.25rem;
		text-align: center;
	}

	.tab-active .tab-badge {
		background: var(--accent);
		color: var(--bg);
	}

	@media (max-width: 767px) {
		.tab-bar {
			overflow-x: auto;
			-webkit-overflow-scrolling: touch;
			scrollbar-width: none;
		}
		.tab-bar::-webkit-scrollbar { display: none; }
		.tab {
			flex-shrink: 0;
			min-height: 44px;
		}
	}
</style>
