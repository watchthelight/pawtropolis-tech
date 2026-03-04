<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import type { TimeWindow } from '$lib/server/queries/stats';

	let { value }: { value: TimeWindow } = $props();

	const windows: { id: TimeWindow; label: string }[] = [
		{ id: '7d', label: '7D' },
		{ id: '30d', label: '30D' },
		{ id: '90d', label: '90D' },
		{ id: 'all', label: 'ALL' }
	];

	function select(w: TimeWindow) {
		if (w === value) return;
		const params = new URLSearchParams($page.url.searchParams);
		params.set('window', w);
		goto(`?${params.toString()}`, { keepFocus: true });
	}
</script>

<div class="selector" role="radiogroup" aria-label="Time window">
	{#each windows as w}
		<button
			role="radio"
			aria-checked={value === w.id}
			class="chip"
			class:active={value === w.id}
			onclick={() => select(w.id)}
		>
			{w.label}
		</button>
	{/each}
</div>

<style>
	.selector {
		display: flex;
		gap: 4px;
	}

	.chip {

		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		padding: 6px 14px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 150ms ease;
	}

	@media (hover: hover) {
		.chip:hover {
			color: var(--text-primary);
			border-color: var(--terminal-border);
		}
	}

	@media (max-width: 767px) {
		.chip {
			min-height: 44px;
			display: flex;
			align-items: center;
		}
	}

	.chip.active {
		color: var(--text-primary);
		background: oklch(72% 0.18 var(--hue) / 0.12);
		border-color: var(--terminal-border);
		box-shadow:
			0 0 8px oklch(72% 0.18 var(--hue) / 0.25),
			inset 0 0 6px oklch(72% 0.18 var(--hue) / 0.08);
	}
</style>
