<script lang="ts">
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import AppDetail from '$lib/components/review/AppDetail.svelte';

	let { data } = $props();
	let app = $derived(data.app);
	let modmail = $derived(data.modmail);
	let sessionUserId = $derived(data.sessionUserId);
	let canAdminUnclaim = $derived(data.canAdminUnclaim);
</script>

<SpringReveal stagger={30}>
	<AppDetail {app} {modmail} {sessionUserId} {canAdminUnclaim} />
</SpringReveal>
