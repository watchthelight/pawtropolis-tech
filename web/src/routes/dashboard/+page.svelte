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
		cdl: 'Community Dev Lead',
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
	<div class="mb-[var(--space-section)] flex items-center gap-5">
		<img
			src={user.avatarUrl}
			alt={user.globalName || user.username}
			class="h-14 w-14 rounded-[var(--radius-md)] ring-2 ring-[var(--accent)] ring-offset-3 ring-offset-[var(--bg)]"
			style:box-shadow="0 0 20px oklch(70% 0.15 var(--hue) / 0.15)"
		/>
		<div>
			<h1 class="text-2xl font-semibold text-[var(--text-primary)] tracking-tight">
				Welcome back, {user.globalName || user.username}
			</h1>
			<span class="inline-flex items-center rounded-[var(--radius-sm)] bg-[var(--surface-raised)] px-2.5 py-0.5 text-xs font-medium text-[var(--text-secondary)]">
				{TIER_LABELS[user.tier] ?? user.tier}
			</span>
		</div>
	</div>

	<!-- Section: Your Queue -->
	<div class="section-heading">Your Queue</div>

	<div class="grid grid-cols-3 gap-[var(--space-section)]">
		<DataCard elevation="md" selected>
			<StatNumber value={metrics.pending} label="Pending" />
		</DataCard>
		<DataCard elevation="sm">
			<StatNumber value={metrics.activeClaims} label="Your Claims" />
		</DataCard>
		<DataCard elevation="sm">
			<StatNumber value={metrics.decisionsToday} label="Decided Today" />
		</DataCard>
	</div>

	<!-- Section: Server Status (Mod+) -->
	{#if metrics.openModmail != null}
		<div class="section-heading mt-[var(--space-section)]">Server Status</div>

		<div class="grid grid-cols-2 gap-[var(--space-section)]">
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
		<div class="mt-[var(--space-section)]">
			<EmptyState message="All clear" subtitle="No pending applications" />
		</div>
	{/if}
</SpringReveal>

<style>
	.section-heading {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-secondary);
		margin-bottom: 1rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--border-holdfast);
	}
</style>
