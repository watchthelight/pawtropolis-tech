<script lang="ts">
	import { STYLES, getStoredStyle, applyStyle, type StyleName } from '$lib/stores/style';
	import { Paintbrush } from 'lucide-svelte';

	let { collapsed = false }: { collapsed?: boolean } = $props();

	let active: StyleName = $state(getStoredStyle());

	function select(id: StyleName) {
		active = id;
		applyStyle(id);
	}
</script>

{#if collapsed}
	<button
		class="icon-btn"
		title="Design style"
		onclick={() => {
			const idx = STYLES.findIndex((s) => s.id === active);
			const next = STYLES[(idx + 1) % STYLES.length];
			select(next.id);
		}}
	>
		<Paintbrush size={16} strokeWidth={1.75} />
	</button>
{:else}
	<div class="switcher">
		<span class="switcher-label">STYLE</span>
		<div class="chips">
			{#each STYLES as style (style.id)}
				<button
					class="chip"
					class:active={active === style.id}
					onclick={() => select(style.id)}
				>
					{style.label}
				</button>
			{/each}
		</div>
	</div>
{/if}

<style>
	.switcher {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.switcher-label {
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		color: var(--text-tertiary);
		text-transform: uppercase;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.chip {
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		padding: 6px 14px;
		border-radius: 4px;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 150ms ease;
		text-transform: uppercase;
	}

	.chip:hover {
		color: var(--text-primary);
	}

	.chip.active {
		color: var(--text-primary);
		background: oklch(72% 0.18 var(--hue) / 0.12);
		border-color: var(--terminal-border);
		box-shadow:
			0 0 8px oklch(72% 0.18 var(--hue) / 0.25),
			inset 0 0 6px oklch(72% 0.18 var(--hue) / 0.08);
	}

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 150ms ease;
	}

	.icon-btn:hover {
		color: var(--text-primary);
		background: var(--surface-raised);
	}

	@media (max-width: 767px) {
		.chip {
			min-height: 44px;
			display: flex;
			align-items: center;
		}
	}
</style>
