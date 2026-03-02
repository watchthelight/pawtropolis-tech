<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
</script>

<SpringReveal stagger={30}>
	<PageHeader title="Security" subtitle="Security audit snapshot" />
	<EmptyState message="Security dashboard coming soon" subtitle="View latest security audit findings and current state." />
</SpringReveal>
