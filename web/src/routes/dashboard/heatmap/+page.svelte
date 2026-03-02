<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
</script>

<SpringReveal stagger={30}>
	<PageHeader title="Heatmap" subtitle="Server activity patterns" />
	<EmptyState message="Activity heatmap coming soon" subtitle="Message volume visualization by hour and day." />
</SpringReveal>
