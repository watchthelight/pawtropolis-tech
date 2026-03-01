<script lang="ts">
	let { data } = $props();
	const { user } = data;
</script>

<div class="max-w-2xl">
	<h1 class="text-2xl font-semibold text-[var(--text-primary)] mb-2">
		Welcome back, {user.globalName || user.username}
	</h1>
	<p class="text-[var(--text-secondary)] mb-6">
		Dashboard tier: <span class="text-[var(--accent)] font-medium">{user.tier}</span>
	</p>

	<div class="bg-[var(--bg-card)] rounded-lg border border-[var(--border)] p-6">
		<div class="flex items-center gap-4 mb-4">
			<img
				src={user.avatarUrl}
				alt={user.username}
				class="w-16 h-16 rounded-full ring-2 ring-[var(--accent)]"
			/>
			<div>
				<p class="text-lg font-medium text-[var(--text-primary)]">{user.globalName || user.username}</p>
				<p class="text-sm text-[var(--text-muted)]">@{user.username}</p>
			</div>
		</div>
		<p class="text-sm text-[var(--text-secondary)]">
			Your dashboard is being built. This is the foundation — features will unlock as development progresses.
		</p>
	</div>
</div>
