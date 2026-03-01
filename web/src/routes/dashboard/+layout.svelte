<script lang="ts">
	let { data, children } = $props();
	const { user } = data;

	// Apply Discord identity theming
	$effect(() => {
		if (user.accentColor) {
			const hex = `#${user.accentColor.toString(16).padStart(6, '0')}`;
			document.documentElement.style.setProperty('--accent', hex);
		}
	});
</script>

<div class="flex min-h-screen bg-[var(--bg-primary)]">
	<!-- Sidebar placeholder — will be built out in next phase -->
	<aside class="w-16 border-r border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col items-center py-4 gap-3">
		<img
			src={user.avatarUrl}
			alt={user.username}
			class="w-10 h-10 rounded-full ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg-secondary)]"
		/>
	</aside>

	<!-- Main content -->
	<main class="flex-1 p-6">
		{@render children()}
	</main>
</div>
