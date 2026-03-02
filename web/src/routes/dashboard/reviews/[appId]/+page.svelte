<script lang="ts">
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import AppDetail from '$lib/components/review/AppDetail.svelte';

	let { data } = $props();
	const { app } = data;
</script>

<SpringReveal stagger={30}>
	<AppDetail {app} />
</SpringReveal>
