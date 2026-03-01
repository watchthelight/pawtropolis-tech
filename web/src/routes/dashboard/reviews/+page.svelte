<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
</script>

<PageHeader title="Reviews" subtitle="Application review queue" />
<EmptyState message="Review workstation coming soon" subtitle="This page will show pending applications for review." />
