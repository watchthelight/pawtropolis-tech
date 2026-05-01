<script lang="ts">
	import { goto } from '$app/navigation';
	import { getIsMobile } from '$lib/stores/viewport.svelte';
	import DataCard from '$lib/components/data/DataCard.svelte';
	import StatNumber from '$lib/components/data/StatNumber.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import { ClipboardList, UserCheck, CheckCircle, Mail, AlertTriangle } from 'lucide-svelte';
	import { openLightbox } from '$lib/stores/lightbox.svelte';

	let { data } = $props();
	let user = $derived(data.user);
	let metrics = $derived(data.metrics);

	// On mobile, default to reviews page
	$effect(() => {
		if (getIsMobile()) goto('/dashboard/reviews', { replaceState: true });
	});

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
	<div class="mb-[var(--space-section)] flex items-center gap-5 max-md:gap-3">
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<img
			src={user.avatarUrl}
			alt={user.globalName || user.username}
			width="56"
			height="56"
			loading="eager"
			decoding="async"
			referrerpolicy="no-referrer"
			class="welcome-avatar"
			style="cursor: zoom-in"
			onclick={() => openLightbox(user.avatarUrl)}
		/>
		<div>
			<h1 class="text-2xl max-md:text-xl font-bold text-[var(--text-primary)]" style="letter-spacing: -0.02em">
				Welcome back, {user.globalName || user.username}
			</h1>
			<span class="tier-badge">
				{TIER_LABELS[user.tier] ?? user.tier}
			</span>
		</div>
	</div>

	<!-- Section: Your Queue -->
	<div class="section-heading">Your Queue</div>

	<div class="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-[var(--space-section)]">
		<DataCard elevation="md" accent clickable onclick={() => goto('/dashboard/reviews?tab=all')}>
			<div class="card-header">
				<ClipboardList size={16} color="var(--accent)" />
				<span class="card-label">Pending</span>
			</div>
			<StatNumber value={metrics.pending} label="" />
			{#if metrics.pendingYours > 0}
				<p class="stat-sub">{metrics.pendingYours} yours</p>
			{/if}
		</DataCard>
		<DataCard elevation="sm" clickable onclick={() => goto('/dashboard/reviews?tab=mine')}>
			<div class="card-header">
				<UserCheck size={16} color="var(--text-tertiary)" />
				<span class="card-label">Your Claims</span>
			</div>
			<StatNumber value={metrics.activeClaims} label="" />
		</DataCard>
		<DataCard elevation="sm">
			<div class="card-header">
				<CheckCircle size={16} color="var(--text-tertiary)" />
				<span class="card-label">Decided Today</span>
			</div>
			<StatNumber value={metrics.decisionsToday} label="" />
		</DataCard>
	</div>

	<!-- Section: Server Status (Mod+) -->
	{#if metrics.openModmail != null}
		<div class="section-heading mt-[var(--space-section)]">Server Status</div>

		<div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-[var(--space-section)]">
			<DataCard elevation="sm" accent={metrics.openModmail > 0}>
				<div class="card-header">
					<Mail size={16} color={metrics.openModmail > 0 ? 'var(--accent)' : 'var(--text-tertiary)'} />
					<span class="card-label">Open Modmail</span>
				</div>
				<StatNumber value={metrics.openModmail} label="" />
			</DataCard>
			<DataCard elevation="sm" accent={(metrics.activeFlags ?? 0) > 0}>
				<div class="card-header">
					<AlertTriangle size={16} color={(metrics.activeFlags ?? 0) > 0 ? 'var(--accent)' : 'var(--text-tertiary)'} />
					<span class="card-label">Active Flags</span>
				</div>
				<StatNumber value={metrics.activeFlags ?? 0} label="" />
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
	.welcome-avatar {
		width: 3.5rem;
		height: 3.5rem;
		border-radius: var(--radius-md);
		outline: 2px solid var(--accent);
		outline-offset: 3px;
		flex-shrink: 0;
	}

	.tier-badge {
		display: inline-flex;
		align-items: center;
		border-radius: var(--radius-sm);
		background: var(--accent-glow-bg);
		border: 1px solid color-mix(in oklch, var(--accent) 30%, transparent);
		padding: 0.15rem 0.6rem;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--accent);
		margin-top: 0.25rem;
	}

	.card-header {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-bottom: 0.5rem;
	}

	.card-label {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--accent-muted);
	}

	.stat-sub {
		font-size: 0.7rem;
		color: var(--text-secondary);
		margin-top: 0.25rem;
	}

	.section-heading {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-secondary);
		margin-bottom: 1rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--border-holdfast);
	}

	.section-heading::before {
		content: '';
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--accent);
		flex-shrink: 0;
	}
</style>
