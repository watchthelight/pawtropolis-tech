<script lang="ts">
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
</script>

<SpringReveal stagger={30}>
	<EmptyState message="Audit Findings" subtitle="Command audit results coming next" />
</SpringReveal>
