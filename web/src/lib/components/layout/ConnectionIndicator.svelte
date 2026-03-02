<script lang="ts">
	import { getConnectionStatus } from '$lib/stores/sse.svelte';
	import { getBotOnline } from '$lib/stores/bot-status.svelte';

	const STATUS_CONFIG = {
		connected: { color: 'var(--status-success)', label: 'Connected', pulse: false },
		connecting: { color: 'var(--status-warning)', label: 'Connecting...', pulse: false },
		reconnecting: { color: 'var(--status-warning)', label: 'Reconnecting...', pulse: true },
		disconnected: { color: 'var(--status-error)', label: 'Disconnected', pulse: false }
	} as const;

	let config = $derived(STATUS_CONFIG[getConnectionStatus()]);
	let botOnline = $derived(getBotOnline());
</script>

<div class="space-y-1">
	<div class="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
		<span
			class="status-dot"
			class:pulse-glow={config.pulse}
			style:background-color={config.color}
			style:box-shadow="0 0 6px {config.color}, 0 0 2px {config.color}"
		></span>
		{config.label}
	</div>
	{#if !botOnline}
		<div class="flex items-center gap-2 text-xs text-[var(--status-error)]">
			<span
				class="status-dot"
				style:background-color="var(--status-error)"
				style:box-shadow="0 0 6px var(--status-error), 0 0 2px var(--status-error)"
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
	}

	.pulse-glow {
		animation: glow-pulse 1.5s ease-in-out infinite;
	}

	@keyframes glow-pulse {
		0%, 100% { box-shadow: 0 0 4px var(--status-warning), 0 0 2px var(--status-warning); }
		50% { box-shadow: 0 0 10px var(--status-warning), 0 0 4px var(--status-warning); }
	}

	@media (prefers-reduced-motion: reduce) {
		.pulse-glow { animation: none; }
	}
</style>
