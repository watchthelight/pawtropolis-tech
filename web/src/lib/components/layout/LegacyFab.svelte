<script lang="ts">
	import { mode, chooseLegacy, isLegacyMode } from '$lib/stores/appearanceStore.svelte';

	let legacy = $derived(isLegacyMode());
	let label = $derived(legacy ? 'Cozy Holdfast' : 'Sage Observatory');
	// Reference the mode store so the label tracks Night/Day changes too.
	let _m = $derived(mode());
</script>

<button
	class="legacy-fab"
	class:on={legacy}
	onclick={() => chooseLegacy(!legacy)}
	title="Revert the whole app to the previous Holdfast look"
	aria-pressed={legacy}
>
	<span class="lswitch"><span class="lswitch-knob"></span></span>
	<span class="legacy-fab-text">
		<span class="legacy-fab-k">Theme</span>
		<span class="legacy-fab-v">{label}</span>
	</span>
</button>

<style>
	.legacy-fab {
		position: fixed;
		right: 1.2rem;
		bottom: 1.2rem;
		z-index: 40;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.55rem 0.75rem 0.55rem 0.85rem;
		background: var(--surface);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius);
		box-shadow: 0 6px 22px oklch(0% 0 0 / 0.35);
		color: var(--ink);
		cursor: pointer;
		transition: border-color var(--duration-fast) var(--ease-smooth),
			transform var(--duration-fast) var(--ease-smooth);
	}
	.legacy-fab:hover { transform: translateY(-1px); border-color: var(--sage); }

	.lswitch {
		position: relative;
		width: 42px;
		height: 23px;
		flex-shrink: 0;
		background: var(--surface-3);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-pill);
	}
	.lswitch-knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 17px;
		height: 17px;
		background: var(--ink-3);
		border-radius: var(--radius-pill);
		transition: transform var(--duration-normal) var(--ease-spring), background-color var(--duration-fast) var(--ease-smooth);
	}
	.legacy-fab.on .lswitch { background: var(--sage-fill); }
	.legacy-fab.on .lswitch-knob { transform: translateX(19px); background: var(--sage); }

	.legacy-fab-text { display: flex; flex-direction: column; line-height: 1.15; text-align: left; }
	.legacy-fab-k {
		font-family: var(--font-mono);
		font-size: 0.56rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--ink-faint);
	}
	.legacy-fab-v {
		font-family: var(--font-head);
		font-size: 0.82rem;
		font-weight: 500;
		color: var(--ink);
		white-space: nowrap;
	}

	@media (max-width: 767px) {
		.legacy-fab { right: 0.8rem; bottom: 0.8rem; }
		.legacy-fab-text { display: none; }
		.legacy-fab { padding: 0.5rem; }
	}
</style>
