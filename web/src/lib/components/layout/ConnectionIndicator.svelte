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
			class="inline-block w-2 h-2 rounded-full shrink-0"
			class:animate-pulse={config.pulse}
			style:background-color={config.color}
		></span>
		{config.label}
	</div>
	{#if !botOnline}
		<div class="flex items-center gap-2 text-xs text-[var(--status-error)]">
			<span class="inline-block w-2 h-2 rounded-full shrink-0 bg-[var(--status-error)]"></span>
			Bot offline
		</div>
	{/if}
</div>
