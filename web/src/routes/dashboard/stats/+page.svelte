<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
</script>

<SpringReveal stagger={30}>
	<PageHeader title="Stats" subtitle="Your review performance" />
	<EmptyState message="Stats page coming soon" subtitle="This page will show your claims, decisions, and response times." />
</SpringReveal>
