<script lang="ts">
	import type { Snippet } from 'svelte';
	type Variant = 'note' | 'warning' | 'tip' | 'info';
	type Props = { variant?: Variant; children: Snippet };
	let { variant = 'info', children }: Props = $props();
</script>

<aside class="hb-callout" data-variant={variant}>
	<header class="hb-callout-head">
		{#if variant === 'warning'}
			<svg viewBox="0 0 16 16" aria-hidden="true">
				<path
					fill="currentColor"
					d="M8 1 1 14h14L8 1Zm.5 5h-1v4h1V6Zm0 5h-1v1.5h1V11Z"
				/>
			</svg>
			<span>Warning</span>
		{:else if variant === 'tip'}
			<svg viewBox="0 0 16 16" aria-hidden="true">
				<path
					fill="currentColor"
					d="M8 1a5 5 0 0 0-3 9v2h6v-2a5 5 0 0 0-3-9Zm-2 12h4v1H6v-1Z"
				/>
			</svg>
			<span>Tip</span>
		{:else if variant === 'note'}
			<svg viewBox="0 0 16 16" aria-hidden="true">
				<path
					fill="currentColor"
					d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 4a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm.5 4h-1v4h1V9Z"
				/>
			</svg>
			<span>Note</span>
		{:else}
			<svg viewBox="0 0 16 16" aria-hidden="true">
				<path
					fill="currentColor"
					d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 4a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm.5 4h-1v4h1V9Z"
				/>
			</svg>
			<span>Info</span>
		{/if}
	</header>
	<div class="hb-callout-body">
		{@render children()}
	</div>
</aside>

<style>
	.hb-callout {
		margin: 0.8em 0 1em;
		padding: 0.6em 0.9em 0.7em 1em;
		border-radius: var(--radius-md);
		border: 1px solid var(--line-soft);
		background: var(--surface);
		border-left-width: 3px;
	}
	.hb-callout[data-variant='warning'] {
		border-left-color: var(--warn);
	}
	.hb-callout[data-variant='tip'] {
		border-left-color: var(--sage);
	}
	.hb-callout[data-variant='note'] {
		border-left-color: var(--tertiary);
	}
	.hb-callout[data-variant='info'] {
		border-left-color: var(--secondary);
	}
	.hb-callout-head {
		display: flex;
		align-items: center;
		gap: 0.45em;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--ink);
		margin-bottom: 0.35em;
	}
	.hb-callout-head svg {
		width: 14px;
		height: 14px;
	}
	.hb-callout[data-variant='warning'] .hb-callout-head {
		color: var(--warn);
	}
	.hb-callout[data-variant='tip'] .hb-callout-head {
		color: var(--sage);
	}
	.hb-callout[data-variant='note'] .hb-callout-head {
		color: var(--tertiary);
	}
	.hb-callout[data-variant='info'] .hb-callout-head {
		color: var(--secondary);
	}
	.hb-callout-body :global(p) {
		margin: 0.25em 0;
		font-size: 0.92rem;
		color: var(--ink-2);
	}
</style>
