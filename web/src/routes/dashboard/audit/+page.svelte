<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
</script>

<SpringReveal stagger={30}>
	<PageHeader title="Audit" subtitle="Action log search" />
	<EmptyState message="Audit log coming soon" subtitle="Search and filter actions by type, actor, target, and date." />
</SpringReveal>
