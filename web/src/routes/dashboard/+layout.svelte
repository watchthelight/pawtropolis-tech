<script lang="ts">
	import { applyTheme } from '$lib/stores/theme';

	let { data, children } = $props();
	const { user } = data;

	$effect(() => {
		applyTheme(user.accentColor);
	});
</script>

<div class="flex min-h-screen bg-[var(--bg)]">
	<!-- Sidebar placeholder — will be built out in Story 1.4 -->
	<aside class="w-16 border-r border-[var(--border)] bg-[var(--surface)] flex flex-col items-center py-4 gap-3">
		<img
			src={user.avatarUrl}
			alt={user.username}
			class="w-10 h-10 rounded-full ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--surface)]"
		/>
	</aside>

	<!-- Main content -->
	<main class="flex-1 p-6">
		{@render children()}
	</main>
</div>
