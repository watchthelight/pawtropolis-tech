<script lang="ts">
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
</script>

<SpringReveal stagger={30}>
	<EmptyState message="Security Audit" subtitle="Snapshot browser coming next" />
</SpringReveal>
