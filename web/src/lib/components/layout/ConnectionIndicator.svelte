<script lang="ts">
	import { getConnectionStatus } from '$lib/stores/sse.svelte';
	import { getBotOnline } from '$lib/stores/bot-status.svelte';

	const STATUS_CONFIG = {
		connected: { color: 'var(--status-success)', label: 'Connected', pulse: false },
		connecting: { color: 'var(--status-warning)', label: 'Connecting...', pulse: false },
		reconnecting: { color: 'var(--status-warning)', label: 'Reconnecting...', pulse: true },
		disconnected: { color: 'var(--status-danger)', label: 'Disconnected', pulse: false }
	} as const;

	let config = $derived(STATUS_CONFIG[getConnectionStatus()]);
	let botOnline = $derived(getBotOnline());
</script>

<div class="space-y-1">
	<div class="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
		<span
			class="status-dot glow"
			class:pulse-glow={config.pulse}
			style:--dot-color={config.color}
		></span>
		{config.label}
	</div>
	{#if !botOnline}
		<div class="flex items-center gap-2 text-xs text-[var(--status-danger)]">
			<span
				class="status-dot glow"
				style:--dot-color="var(--status-danger)"
			></span>
			Bot offline
		</div>
	{/if}
</div>

<style>
	.status-dot {
		display: inline-block;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		flex-shrink: 0;
		background-color: var(--dot-color);
	}

	/* Base glow — applied via CSS so it doesn't override animation */
	.glow {
		box-shadow: 0 0 6px var(--dot-color), 0 0 2px var(--dot-color);
	}

	/* Pulse overrides .glow's box-shadow via animation — works because
	   both are in the stylesheet (same specificity layer) */
	.pulse-glow {
		animation: glow-pulse 1.5s ease-in-out infinite;
	}

	@keyframes glow-pulse {
		0%, 100% { box-shadow: 0 0 4px var(--dot-color), 0 0 2px var(--dot-color); }
		50% { box-shadow: 0 0 10px var(--dot-color), 0 0 4px var(--dot-color); }
	}

	@media (prefers-reduced-motion: reduce) {
		.pulse-glow { animation: none; }
	}
</style>
