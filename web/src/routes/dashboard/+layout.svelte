<script lang="ts">
	import { applyTheme } from '$lib/stores/theme';
	import Nav from '$lib/components/layout/Nav.svelte';

	let { data, children } = $props();
	const { user } = data;

	$effect(() => {
		applyTheme(user.accentColor);
	});
</script>

<div class="flex min-h-screen bg-[var(--bg)]">
	<aside class="w-60 shrink-0">
		<Nav {user} />
	</aside>

	<main class="flex-1 p-6">
		{@render children()}
	</main>
</div>
