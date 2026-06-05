<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import {
		type TimeWindowSpec,
		type PresetWindow,
		windowToParams,
		isPresetEqual
	} from '$lib/shared/timeWindow';

	let { value }: { value: TimeWindowSpec } = $props();

	const presets: { id: PresetWindow; label: string }[] = [
		{ id: '7d', label: '7D' },
		{ id: '30d', label: '30D' },
		{ id: '90d', label: '90D' },
		{ id: 'all', label: 'ALL' }
	];

	let customOpen = $state(false);
	let customFrom = $state('');
	let customTo = $state('');

	// Seed inputs from current spec when opening
	function openCustom() {
		if (value.kind === 'custom') {
			customFrom = new Date(value.fromS * 1000).toISOString().slice(0, 10);
			customTo = new Date(value.toS * 1000).toISOString().slice(0, 10);
		} else {
			// Sensible defaults: last 14 days
			const now = new Date();
			const start = new Date(now);
			start.setUTCDate(start.getUTCDate() - 14);
			customFrom = start.toISOString().slice(0, 10);
			customTo = now.toISOString().slice(0, 10);
		}
		customOpen = true;
	}

	function selectPreset(p: PresetWindow) {
		if (isPresetEqual(value, p)) return;
		const params = windowToParams({ kind: 'preset', preset: p }, $page.url.searchParams);
		goto(`?${params.toString()}`, { keepFocus: true });
	}

	function applyCustom() {
		if (!customFrom || !customTo) return;
		const fromS = Math.floor(Date.parse(customFrom + 'T00:00:00Z') / 1000);
		const toS = Math.floor(Date.parse(customTo + 'T23:59:59Z') / 1000);
		if (!Number.isFinite(fromS) || !Number.isFinite(toS) || toS <= fromS) return;
		const params = windowToParams({ kind: 'custom', fromS, toS }, $page.url.searchParams);
		customOpen = false;
		goto(`?${params.toString()}`, { keepFocus: true });
	}

	function closeCustom() {
		customOpen = false;
	}

	function customLabel(): string {
		if (value.kind !== 'custom') return 'Custom';
		const fmt = new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		});
		return `${fmt.format(new Date(value.fromS * 1000))} – ${fmt.format(new Date(value.toS * 1000))}`;
	}
</script>

<div class="wrap">
	<div class="selector" role="radiogroup" aria-label="Time window">
		{#each presets as w}
			<button
				role="radio"
				aria-checked={isPresetEqual(value, w.id)}
				class="chip"
				class:active={isPresetEqual(value, w.id)}
				onclick={() => selectPreset(w.id)}
			>
				{w.label}
			</button>
		{/each}
		<button
			type="button"
			class="chip custom-chip"
			class:active={value.kind === 'custom'}
			onclick={openCustom}
			aria-expanded={customOpen}
			aria-haspopup="dialog"
			title="Pick a custom date range"
		>
			{customLabel()}
		</button>
	</div>

	{#if customOpen}
		<div
			class="popover"
			role="dialog"
			aria-label="Custom time range"
			tabindex="-1"
			onkeydown={(e) => {
				if (e.key === 'Escape') closeCustom();
				if (e.key === 'Enter') applyCustom();
			}}
		>
			<label class="field">
				<span>From</span>
				<input type="date" bind:value={customFrom} max={customTo || undefined} />
			</label>
			<label class="field">
				<span>To</span>
				<input type="date" bind:value={customTo} min={customFrom || undefined} />
			</label>
			<div class="actions">
				<button type="button" class="btn btn-ghost" onclick={closeCustom}>Cancel</button>
				<button
					type="button"
					class="btn btn-primary"
					onclick={applyCustom}
					disabled={!customFrom || !customTo || customFrom >= customTo}
				>
					Apply
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.wrap {
		position: relative;
		display: inline-block;
	}

	.selector {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}

	.chip {
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		padding: 6px 14px;
		border: 1px solid var(--line-soft);
		border-radius: 4px;
		background: transparent;
		color: var(--ink-2);
		cursor: pointer;
		transition: all 150ms ease;
	}

	.custom-chip {
		letter-spacing: 0.04em;
		text-transform: none;
		font-variant-numeric: tabular-nums;
	}

	@media (hover: hover) {
		.chip:hover {
			color: var(--ink);
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
		color: var(--ink);
		background: oklch(72% 0.18 var(--hue) / 0.12);
		border-color: var(--terminal-border);
		box-shadow:
			0 0 8px oklch(72% 0.18 var(--hue) / 0.25),
			inset 0 0 6px oklch(72% 0.18 var(--hue) / 0.08);
	}

	.popover {
		position: absolute;
		top: calc(100% + 8px);
		right: 0;
		z-index: 20;
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 14px;
		min-width: 240px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg, 0 10px 30px rgba(0, 0, 0, 0.25));
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 0.72rem;
		color: var(--ink-2);
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.field input {
		background: var(--surface-2, var(--surface));
		color: var(--ink);
		border: 1px solid var(--line-soft);
		border-radius: 4px;
		padding: 6px 8px;
		font-size: 0.85rem;
		font-family: inherit;
	}

	.field input:focus {
		outline: none;
		border-color: var(--terminal-border);
		box-shadow: 0 0 0 2px oklch(72% 0.18 var(--hue) / 0.2);
	}

	.actions {
		display: flex;
		gap: 6px;
		justify-content: flex-end;
		margin-top: 4px;
	}

	.btn {
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		padding: 6px 12px;
		border-radius: 4px;
		cursor: pointer;
		border: 1px solid var(--line-soft);
		background: transparent;
		color: var(--ink-2);
		transition: all 150ms ease;
	}

	.btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.btn-primary {
		color: var(--ink);
		background: oklch(72% 0.18 var(--hue) / 0.15);
		border-color: var(--terminal-border);
	}

	@media (hover: hover) {
		.btn:hover:not(:disabled) {
			color: var(--ink);
			border-color: var(--terminal-border);
		}
	}

	@media (max-width: 480px) {
		.popover {
			right: auto;
			left: 0;
			min-width: 200px;
		}
	}
</style>
