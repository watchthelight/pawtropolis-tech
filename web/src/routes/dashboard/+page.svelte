<script lang="ts">
	import DataCard from '$lib/components/data/DataCard.svelte';
	import StatNumber from '$lib/components/data/StatNumber.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';

	let { data } = $props();
	const { user, metrics } = data;

	const TIER_LABELS: Record<string, string> = {
		owner: 'Owner / Dev',
		cm: 'Community Manager',
		sa: 'Senior Administrator',
		admin: 'Administrator',
		sm: 'Senior Moderator',
		mod: 'Moderator',
		jm: 'Junior Moderator',
		gk: 'Gatekeeper',
		viewer: 'Mod Team (View Only)',
		none: 'No Access'
	};
</script>

<SpringReveal stagger={30}>
	<!-- Identity section -->
	<div class="mb-8 flex items-center gap-4">
		<img
			src={user.avatarUrl}
			alt={user.globalName || user.username}
			class="h-12 w-12 rounded-full ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg)]"
		/>
		<div>
			<h1 class="text-2xl font-semibold text-[var(--text-primary)]">
				Welcome back, {user.globalName || user.username}
			</h1>
			<span class="inline-flex items-center rounded-full bg-[var(--surface-raised)] px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)]">
				{TIER_LABELS[user.tier] ?? user.tier}
			</span>
		</div>
	</div>

	<!-- Stat cards — all tiers see these 3 -->
	<div class="grid grid-cols-3 gap-4">
		<DataCard elevation="sm">
			<StatNumber value={metrics.pending} label="Pending" />
		</DataCard>
		<DataCard elevation="sm">
			<StatNumber value={metrics.activeClaims} label="Your Claims" />
		</DataCard>
		<DataCard elevation="sm">
			<StatNumber value={metrics.decisionsToday} label="Decided Today" />
		</DataCard>
	</div>

	<!-- Mod+ stat cards -->
	{#if metrics.openModmail != null}
		<div class="mt-4 grid grid-cols-2 gap-4">
			<DataCard elevation="sm">
				<StatNumber value={metrics.openModmail} label="Open Modmail" />
			</DataCard>
			<DataCard elevation="sm">
				<StatNumber value={metrics.activeFlags ?? 0} label="Active Flags" />
			</DataCard>
		</div>
	{/if}

	<!-- Empty state when no pending applications -->
	{#if metrics.pending === 0}
		<div class="mt-6">
			<EmptyState message="All clear" subtitle="No pending applications" />
		</div>
	{/if}
</SpringReveal>
