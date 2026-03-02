<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
</script>

<SpringReveal stagger={30}>
	<PageHeader title="Art" subtitle="Artist queue and assignments" />
	<EmptyState message="Art queue coming soon" subtitle="View artist rotation order and active job assignments." />
</SpringReveal>
