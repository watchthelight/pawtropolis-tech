<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
</script>

<PageHeader title="Pulse" subtitle="Server overview at a glance" />
<EmptyState message="Server pulse coming soon" subtitle="Pending apps, open modmail, flags, and activity summary." />
