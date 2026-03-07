<script lang="ts">
	import { applyPalette, resetToDiscordTheme } from '$lib/stores/theme';

	let { collapsed = false }: { collapsed?: boolean } = $props();

	const PRESETS = [
		{ name: 'Discord', hue: null },
		{ name: 'Forest', hue: 145 },
		{ name: 'Ocean', hue: 220 },
		{ name: 'Sunset', hue: 25 },
		{ name: 'Amethyst', hue: 290 },
		{ name: 'Rose', hue: 340 },
		{ name: 'Gold', hue: 55 },
		{ name: 'Teal', hue: 175 },
		{ name: 'Slate', hue: 235 },
		{ name: 'Crimson', hue: 10 },
		{ name: 'Lavender', hue: 270 },
	] as const;

	let presetIndex = $state(0);
	let customHue: number | null = $state(null);

	function currentHue(): string {
		if (customHue !== null) return `oklch(0.72 0.18 ${customHue})`;
		const preset = PRESETS[presetIndex];
		if (preset.hue === null) return 'var(--accent)';
		return `oklch(0.72 0.18 ${preset.hue})`;
	}

	function currentLabel(): string {
		if (customHue !== null) return `${customHue}°`;
		return PRESETS[presetIndex].name;
	}

	function applyPreset(index: number): void {
		presetIndex = index;
		customHue = null;
		const preset = PRESETS[index];
		if (preset.hue === null) {
			resetToDiscordTheme();
		} else {
			applyPalette(preset.hue);
		}
	}

	function cyclePreset(direction: 1 | -1): void {
		const next = (presetIndex + direction + PRESETS.length) % PRESETS.length;
		applyPreset(next);
	}

	function shuffle(): void {
		const hue = Math.floor(Math.random() * 360);
		customHue = hue;
		presetIndex = 0; // reset preset index
		applyPalette(hue);
	}
</script>

{#if collapsed}
	<button
		class="shuffle-btn"
		onclick={shuffle}
		title="Shuffle theme"
		aria-label="Shuffle theme"
	>
		<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<path d="M13.5 2.5v3h-3M2.5 13.5v-3h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
			<path d="M2.5 6.5a5.5 5.5 0 0 1 9.17-2.5M13.5 9.5a5.5 5.5 0 0 1-9.17 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
		</svg>
	</button>
{:else}
	<div class="theme-controls">
		<button
			class="arrow-btn"
			onclick={() => cyclePreset(-1)}
			title="Previous theme"
			aria-label="Previous theme"
		>
			<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
				<path d="M6.5 2L3.5 5L6.5 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		</button>

		<div class="swatch-label">
			<span class="swatch" style:background={currentHue()}></span>
			<span class="label">{currentLabel()}</span>
		</div>

		<button
			class="arrow-btn"
			onclick={() => cyclePreset(1)}
			title="Next theme"
			aria-label="Next theme"
		>
			<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
				<path d="M3.5 2L6.5 5L3.5 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		</button>

		<button
			class="shuffle-btn"
			onclick={shuffle}
			title="Random theme"
			aria-label="Random theme"
		>
			<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
				<path d="M13.5 2.5v3h-3M2.5 13.5v-3h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
				<path d="M2.5 6.5a5.5 5.5 0 0 1 9.17-2.5M13.5 9.5a5.5 5.5 0 0 1-9.17 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		</button>
	</div>
{/if}

<style>
	.theme-controls {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.arrow-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		padding: 0;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 150ms var(--ease-smooth);
		flex-shrink: 0;
	}

	.arrow-btn:hover {
		color: var(--text-primary);
		background: var(--surface-raised);
	}

	.swatch-label {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex: 1;
		min-width: 0;
	}

	.swatch {
		display: inline-block;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		flex-shrink: 0;
		box-shadow: 0 0 4px currentColor;
	}

	.label {
		font-size: 0.7rem;
		color: var(--text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.shuffle-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		padding: 0;
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 150ms var(--ease-smooth);
		flex-shrink: 0;
	}

	.shuffle-btn:hover {
		color: var(--text-primary);
		background: var(--surface-raised);
	}
</style>
