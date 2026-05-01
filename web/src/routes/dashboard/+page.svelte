<script lang="ts">
	import { goto } from '$app/navigation';
	import { getIsMobile } from '$lib/stores/viewport.svelte';
	import StatNumber from '$lib/components/data/StatNumber.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import {
		ClipboardList, UserCheck, CheckCircle, Mail, AlertTriangle,
		ArrowRight, Activity, Inbox, Sparkles
	} from 'lucide-svelte';
	import { openLightbox } from '$lib/stores/lightbox.svelte';
	import { relativeTime } from '$lib/utils/time';

	let { data } = $props();
	let user = $derived(data.user);
	let metrics = $derived(data.metrics);

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

	function decisionLabel(action: string): string {
		const map: Record<string, string> = {
			approve: 'Approved', reject: 'Rejected', kick: 'Kicked', perm_reject: 'Perm-rejected'
		};
		return map[action] ?? action;
	}
	function decisionTone(action: string): string {
		if (action === 'approve') return 'tone-good';
		if (action === 'reject' || action === 'kick' || action === 'perm_reject') return 'tone-danger';
		return '';
	}
	function actionIcon(item: typeof metrics.recentActivity[number]): string {
		if (item.type === 'modmail') return '📩';
		if (item.action === 'approve') return '✓';
		if (item.action === 'reject' || item.action === 'perm_reject') return '✕';
		if (item.action === 'kick') return '👢';
		return '·';
	}

	let primary = $derived(metrics.nextActions?.[0] ?? null);
	let secondary = $derived(metrics.nextActions?.slice(1, 3) ?? []);
</script>

<SpringReveal stagger={30}>
	<!-- Identity banner -->
	<div class="welcome-row">
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
			onclick={() => openLightbox(user.avatarUrl)}
		/>
		<div>
			<h1 class="welcome-name">Welcome back, {user.globalName || user.username}</h1>
			<span class="tier-badge">{TIER_LABELS[user.tier] ?? user.tier}</span>
		</div>
	</div>

	<!-- ── Next action hero ────────────────────────────────────────────── -->
	{#if primary}
		<button
			class="hero hero-{primary.kind}"
			onclick={() => goto(primary.href)}
			disabled={primary.kind === 'idle'}
		>
			<div class="hero-icon">
				{#if primary.kind === 'idle'}
					<Sparkles size={26} />
				{:else if primary.kind === 'unread_modmail'}
					<Mail size={26} />
				{:else if primary.kind === 'flagged_user'}
					<AlertTriangle size={26} />
				{:else}
					<ClipboardList size={26} />
				{/if}
			</div>
			<div class="hero-text">
				<span class="hero-eyebrow">{primary.kind === 'idle' ? 'Inbox zero' : 'Next up'}</span>
				<span class="hero-label">{primary.label}</span>
				<span class="hero-sub">{primary.subtitle}</span>
			</div>
			{#if primary.kind !== 'idle'}
				<ArrowRight size={22} class="hero-arrow" />
			{/if}
		</button>

		{#if secondary.length > 0}
			<div class="secondary-row">
				{#each secondary as a}
					<button class="secondary" onclick={() => goto(a.href)}>
						<span class="sec-label">{a.label}</span>
						<span class="sec-sub">{a.subtitle}</span>
					</button>
				{/each}
			</div>
		{/if}
	{/if}

	<!-- ── Your queue ──────────────────────────────────────────────────── -->
	<div class="section-heading">Your queue</div>
	<div class="metric-grid">
		<button class="metric" onclick={() => goto('/dashboard/reviews?tab=all')}>
			<div class="metric-head"><ClipboardList size={16} color="var(--accent)" /><span class="metric-label">Pending</span></div>
			<StatNumber value={metrics.pending} label="" />
			{#if metrics.pendingYours > 0}<span class="metric-sub">{metrics.pendingYours} yours</span>{/if}
		</button>
		<button class="metric" onclick={() => goto('/dashboard/reviews?tab=mine')}>
			<div class="metric-head"><UserCheck size={16} color="var(--text-tertiary)" /><span class="metric-label">Your claims</span></div>
			<StatNumber value={metrics.activeClaims} label="" />
		</button>
		<button class="metric" onclick={() => goto('/dashboard/stats')}>
			<div class="metric-head"><CheckCircle size={16} color="var(--text-tertiary)" /><span class="metric-label">Decided today</span></div>
			<StatNumber value={metrics.decisionsToday} label="" />
		</button>
		<button class="metric" onclick={() => goto('/dashboard/stats')}>
			<div class="metric-head"><Activity size={16} color="var(--text-tertiary)" /><span class="metric-label">This week</span></div>
			<StatNumber value={metrics.weekStats.decisions} label="" />
			{#if metrics.weekStats.avgResponseMin != null}
				<span class="metric-sub">avg {metrics.weekStats.avgResponseMin}m to decide</span>
			{/if}
		</button>
	</div>

	<!-- ── Server status (mod+) ────────────────────────────────────────── -->
	{#if metrics.openModmail != null}
		<div class="section-heading">Server status</div>
		<div class="metric-grid">
			<button class="metric" class:metric-warn={metrics.openModmail > 0} onclick={() => goto('/dashboard/modmail?filter=open')}>
				<div class="metric-head"><Mail size={16} color={metrics.openModmail > 0 ? 'var(--accent)' : 'var(--text-tertiary)'} /><span class="metric-label">Open modmail</span></div>
				<StatNumber value={metrics.openModmail} label="" />
			</button>
			<button class="metric" class:metric-warn={(metrics.activeFlags ?? 0) > 0} onclick={() => goto('/dashboard/flags')}>
				<div class="metric-head"><AlertTriangle size={16} color={(metrics.activeFlags ?? 0) > 0 ? 'var(--accent)' : 'var(--text-tertiary)'} /><span class="metric-label">Active flags</span></div>
				<StatNumber value={metrics.activeFlags ?? 0} label="" />
			</button>
		</div>
	{/if}

	<!-- ── Activity feed ───────────────────────────────────────────────── -->
	{#if metrics.recentActivity && metrics.recentActivity.length > 0}
		<div class="section-heading">Your recent activity</div>
		<ul class="feed">
			{#each metrics.recentActivity as item}
				<li>
					<button class="feed-row" onclick={() => goto(item.href)}>
						<span class="feed-icon {decisionTone(item.action)}">{actionIcon(item)}</span>
						<span class="feed-text">
							{#if item.type === 'decision'}
								<span class="feed-action {decisionTone(item.action)}">{decisionLabel(item.action)}</span>
								<span class="feed-subject">{item.subjectName}</span>
							{:else}
								<span class="feed-action">Replied</span>
								<span class="feed-subject">{item.subjectName}</span>
							{/if}
						</span>
						<span class="feed-time">{relativeTime(item.createdAt * 1000)}</span>
					</button>
				</li>
			{/each}
		</ul>
	{:else if metrics.openModmail != null}
		<div class="section-heading">Your recent activity</div>
		<EmptyState message="Quiet shift" subtitle="No recent decisions or modmail replies from you." />
	{/if}

	<!-- Empty state when no pending applications and no mod tier -->
	{#if metrics.openModmail == null && metrics.pending === 0}
		<EmptyState message="All clear" subtitle="No pending applications." />
	{/if}
</SpringReveal>

<style>
	.welcome-row { display: flex; align-items: center; gap: 1.1rem; margin-bottom: 1.5rem; }
	.welcome-avatar {
		border-radius: var(--radius-md);
		outline: 2px solid var(--accent);
		outline-offset: 3px;
		flex-shrink: 0;
		cursor: zoom-in;
	}
	.welcome-name { font-size: 1.5rem; font-weight: 700; color: var(--text-primary); letter-spacing: -0.02em; margin: 0; }
	.tier-badge {
		display: inline-flex; align-items: center;
		border-radius: var(--radius-sm);
		background: var(--accent-glow-bg);
		border: 1px solid color-mix(in oklch, var(--accent) 30%, transparent);
		padding: 0.15rem 0.6rem;
		font-size: 0.75rem; font-weight: 500; color: var(--accent);
		margin-top: 0.25rem;
	}

	/* ── Hero next-action card ───────────────────────────────────────── */
	.hero {
		display: flex;
		align-items: center;
		gap: 1.1rem;
		width: 100%;
		text-align: left;
		padding: 1.1rem 1.3rem;
		background: var(--surface);
		border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-md);
		cursor: pointer;
		margin-bottom: 0.85rem;
		transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
	}
	.hero:hover:not(:disabled) {
		transform: translateY(-1px);
		border-color: var(--accent);
		box-shadow: var(--shadow-md);
	}
	.hero:disabled { cursor: default; opacity: 0.85; }
	.hero-unread_modmail { border-left: 4px solid var(--status-info, var(--accent)); }
	.hero-unclaimed_app { border-left: 4px solid var(--accent); }
	.hero-flagged_user { border-left: 4px solid var(--status-warning); }
	.hero-icon {
		width: 48px; height: 48px;
		display: flex; align-items: center; justify-content: center;
		border-radius: var(--radius-md);
		background: var(--accent-dim);
		color: var(--accent);
		flex-shrink: 0;
	}
	.hero-text { display: flex; flex-direction: column; flex: 1; gap: 0.15rem; min-width: 0; }
	.hero-eyebrow { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-tertiary); font-weight: 600; }
	.hero-label { font-size: 1rem; color: var(--text-primary); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.hero-sub { font-size: 0.78rem; color: var(--text-secondary); }
	:global(.hero-arrow) { color: var(--text-tertiary); flex-shrink: 0; }

	.secondary-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.5rem;
		margin-bottom: 1.25rem;
	}
	.secondary {
		text-align: left; padding: 0.65rem 0.85rem;
		background: var(--surface); border: 1px solid var(--border);
		border-radius: var(--radius-sm); cursor: pointer;
		display: flex; flex-direction: column; gap: 0.15rem;
		transition: border-color 0.15s ease;
	}
	.secondary:hover { border-color: var(--text-secondary); }
	.sec-label { font-size: 0.82rem; color: var(--text-primary); font-weight: 500; }
	.sec-sub { font-size: 0.7rem; color: var(--text-secondary); }

	/* ── Section + metric grid ───────────────────────────────────────── */
	.section-heading {
		display: flex; align-items: center; gap: 0.5rem;
		font-size: 0.7rem; font-weight: 600; text-transform: uppercase;
		letter-spacing: 0.08em; color: var(--text-secondary);
		margin: 1.5rem 0 0.7rem;
		padding-bottom: 0.4rem;
		border-bottom: 1px solid var(--border-holdfast);
	}
	.section-heading::before { content: ''; width: 4px; height: 4px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }

	.metric-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.85rem;
	}
	.metric {
		display: flex; flex-direction: column; gap: 0.15rem;
		padding: 0.85rem 1rem;
		background: var(--surface); border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-md);
		cursor: pointer; text-align: left;
		transition: transform 0.15s ease, border-color 0.15s ease;
	}
	.metric:hover { transform: translateY(-1px); border-color: var(--text-secondary); }
	.metric-warn { border-color: var(--accent); }
	.metric-head { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.2rem; }
	.metric-label { font-size: 0.65rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-tertiary); }
	.metric-sub { font-size: 0.7rem; color: var(--text-secondary); margin-top: 0.15rem; }

	/* ── Activity feed ───────────────────────────────────────────────── */
	.feed { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
	.feed-row {
		display: flex; align-items: center; gap: 0.7rem;
		width: 100%; padding: 0.55rem 0.8rem;
		background: var(--surface); border: 1px solid var(--border);
		border-radius: var(--radius-sm); cursor: pointer; text-align: left;
		transition: background 0.15s ease;
	}
	.feed-row:hover { background: var(--surface-raised); }
	.feed-icon {
		width: 26px; height: 26px;
		display: flex; align-items: center; justify-content: center;
		border-radius: var(--radius-sm);
		background: var(--surface-raised);
		color: var(--text-secondary);
		font-size: 0.85rem; font-weight: 700;
		flex-shrink: 0;
	}
	.feed-icon.tone-good { background: oklch(28% 0.06 145); color: oklch(80% 0.14 145); }
	.feed-icon.tone-danger { background: oklch(28% 0.06 25); color: oklch(80% 0.14 25); }
	.feed-text { flex: 1; min-width: 0; display: flex; gap: 0.5rem; align-items: baseline; overflow: hidden; }
	.feed-action { font-size: 0.78rem; color: var(--text-primary); font-weight: 500; flex-shrink: 0; }
	.feed-action.tone-good { color: oklch(80% 0.14 145); }
	.feed-action.tone-danger { color: oklch(80% 0.14 25); }
	.feed-subject { font-size: 0.78rem; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.feed-time { font-size: 0.7rem; color: var(--text-tertiary); flex-shrink: 0; }
</style>
