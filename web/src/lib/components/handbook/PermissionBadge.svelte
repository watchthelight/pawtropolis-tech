<script lang="ts">
	import { HANDBOOK_TIER_LABELS, type HandbookTier } from '$lib/server/handbook/permissionResolver';

	type Props = {
		tier: HandbookTier;
		canRun: boolean;
		exactOnly?: boolean;
	};

	let { tier, canRun, exactOnly = false }: Props = $props();

	let label = $derived(HANDBOOK_TIER_LABELS[tier] + (exactOnly ? ' (exclusive)' : ''));
</script>

<span
	class="badge"
	class:badge-run={canRun}
	class:badge-locked={!canRun}
	data-tier={tier}
	title={canRun ? 'You can run this.' : 'You can read it, but cannot run it.'}
>
	{#if canRun}
		<span class="dot" aria-hidden="true"></span>
	{:else}
		<svg class="lock" viewBox="0 0 16 16" aria-hidden="true">
			<path
				fill="currentColor"
				d="M5 7V5a3 3 0 1 1 6 0v2h.5A1.5 1.5 0 0 1 13 8.5v4A1.5 1.5 0 0 1 11.5 14h-7A1.5 1.5 0 0 1 3 12.5v-4A1.5 1.5 0 0 1 4.5 7H5Zm1 0h4V5a2 2 0 1 0-4 0v2Z"
			/>
		</svg>
	{/if}
	<span class="label">{label}</span>
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 0.4em;
		padding: 0.2em 0.6em;
		border-radius: var(--radius-sm);
		font-size: 0.78rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		line-height: 1.2;
		border: 1px solid var(--border-holdfast);
		background: var(--surface-raised);
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.badge-run {
		color: oklch(95% 0.04 145);
		border-color: oklch(45% 0.10 145);
		background: oklch(22% 0.06 145);
	}
	.badge-locked {
		color: var(--text-tertiary);
		border-color: var(--border);
		background: var(--surface);
	}
	.dot {
		width: 0.5em;
		height: 0.5em;
		border-radius: 50%;
		background: oklch(70% 0.18 145);
		box-shadow: 0 0 6px oklch(70% 0.18 145 / 0.6);
	}
	.lock {
		width: 0.85em;
		height: 0.85em;
	}
	.label {
		font-variant-numeric: tabular-nums;
	}
</style>
