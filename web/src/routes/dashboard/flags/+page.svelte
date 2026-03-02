<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
</script>

<SpringReveal stagger={30}>
	<PageHeader title="Flags" subtitle="Flagged user triage" />
	<EmptyState message="Flag management coming soon" subtitle="View, dismiss, and escalate flagged users." />
</SpringReveal>
