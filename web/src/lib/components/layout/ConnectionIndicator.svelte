<script lang="ts">
	import { getConnectionStatus } from '$lib/stores/sse.svelte';
	import { getBotOnline } from '$lib/stores/bot-status.svelte';

	const STATUS_CONFIG = {
		connected: { color: 'var(--good)', label: 'Connected', pulse: false },
		connecting: { color: 'var(--warn)', label: 'Connecting...', pulse: false },
		reconnecting: { color: 'var(--warn)', label: 'Reconnecting...', pulse: true },
		disconnected: { color: 'var(--danger)', label: 'Disconnected', pulse: false }
	} as const;

	let config = $derived(STATUS_CONFIG[getConnectionStatus()]);
	let botOnline = $derived(getBotOnline());
</script>

<div class="space-y-1">
	<div class="flex items-center gap-2 text-xs text-[var(--ink-2)]">
		<span
			class="status-dot"
			class:pulse-glow={config.pulse}
			style:--dot-color={config.color}
		></span>
		{config.label}
	</div>
	{#if !botOnline}
		<div class="flex items-center gap-2 text-xs text-[var(--danger)]">
			<span
				class="status-dot"
				style:--dot-color="var(--danger)"
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

	/* Pulse for reconnecting state only */
	.pulse-glow {
		animation: glow-pulse 1.5s ease-in-out infinite;
	}

	@keyframes glow-pulse {
		0%, 100% { box-shadow: 0 0 2px var(--dot-color); }
		50% { box-shadow: 0 0 6px var(--dot-color); }
	}

	@media (prefers-reduced-motion: reduce) {
		.pulse-glow { animation: none; }
	}
</style>
