<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
</script>

<PageHeader title="Audit" subtitle="Action log search" />
<EmptyState message="Audit log coming soon" subtitle="Search and filter actions by type, actor, target, and date." />
