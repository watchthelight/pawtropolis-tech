<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
</script>

<SpringReveal stagger={30}>
	<PageHeader title="Config" subtitle="Bot and guild settings" />
	<EmptyState message="Configuration viewer coming soon" subtitle="View current bot and guild configuration settings." />
</SpringReveal>
