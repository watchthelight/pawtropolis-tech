<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
</script>

<SpringReveal stagger={30}>
	<PageHeader title="Pulse" subtitle="Server overview at a glance" />
	<EmptyState message="Server pulse coming soon" subtitle="Pending apps, open modmail, flags, and activity summary." />
</SpringReveal>
