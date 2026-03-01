<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
</script>

<PageHeader title="System" subtitle="Bot system health" />
<EmptyState message="System health monitor coming soon" subtitle="Uptime, WebSocket ping, memory usage, and disk space." />
