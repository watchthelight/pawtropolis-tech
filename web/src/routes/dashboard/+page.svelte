<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getIsMobile } from '$lib/stores/viewport.svelte';
	import CountUp from '$lib/components/data/CountUp.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import { tilt } from '$lib/actions/tilt';
	import {
		ClipboardList, UserCheck, CheckCircle, Mail, AlertTriangle,
		ArrowRight, Activity, Sparkles
	} from 'lucide-svelte';
	import { relativeTime } from '$lib/utils/time';
	import WhatsNewBanner from '$lib/components/handbook/WhatsNewBanner.svelte';

	let { data } = $props();
	let user = $derived(data.user);
	let metrics = $derived(data.metrics);
	let whatsNew = $derived(data.whatsNew ?? []);

	$effect(() => {
		if (getIsMobile()) goto('/dashboard/reviews', { replaceState: true });
	});

	let timeOfDay = $state('Welcome back');
	let dateLabel = $state('');
	onMount(() => {
		const d = new Date();
		const h = d.getHours();
		timeOfDay =
			h < 5 ? 'Late watch' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Night watch';
		dateLabel = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
	});

	const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
	const nw = (n: number) => (n >= 0 && n <= 9 ? WORDS[n] : String(n));
	const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

	let subline = $derived.by(() => {
		const p = metrics.pending ?? 0;
		const inbox = metrics.openModmail as number | null;
		const gate =
			p === 0 ? 'nobody is waiting at the gate' :
			p === 1 ? 'one applicant is waiting at the gate' :
			`${nw(p)} applicants are waiting at the gate`;
		let inboxPart = '';
		if (inbox != null) {
			inboxPart =
				inbox === 0 ? ', and your inbox is clear' :
				inbox === 1 ? ', and one modmail needs a reply' :
				`, and ${nw(inbox)} modmails need a reply`;
		}
		const calm = p + (inbox ?? 0) === 0 ? 'A quiet shift so far.' : 'A calm shift so far.';
		return `${calm} ${cap(gate)}${inboxPart}.`;
	});

	function decisionLabel(action: string): string {
		const map: Record<string, string> = { approve: 'Approved', reject: 'Rejected', kick: 'Kicked', perm_reject: 'Perm-rejected' };
		return map[action] ?? action;
	}
	function decisionTone(action: string): string {
		if (action === 'approve') return 'tone-good';
		if (action === 'reject' || action === 'kick' || action === 'perm_reject') return 'tone-danger';
		return '';
	}
	function actionIcon(item: typeof metrics.recentActivity[number]): string {
		if (item.type === 'modmail') return '✉';
		if (item.action === 'approve') return '✓';
		if (item.action === 'reject' || item.action === 'perm_reject') return '✕';
		if (item.action === 'kick') return '→';
		return '·';
	}

	let primary = $derived(metrics.nextActions?.[0] ?? null);
	let secondary = $derived(metrics.nextActions?.slice(1, 3) ?? []);
</script>

<SpringReveal stagger={28}>
	<!-- Greeting -->
	<header class="greet">
		<span class="greet-eyebrow">{dateLabel ? `${dateLabel} · ${timeOfDay}` : timeOfDay}</span>
		<h1 class="greet-title">Welcome back to the Observatory</h1>
		<p class="greet-sub">{subline}</p>
	</header>

	<WhatsNewBanner entries={whatsNew} compact />

	<!-- Next action hero -->
	{#if primary}
		<button
			class="hero paper hero-{primary.kind}"
			onclick={() => goto(primary.href)}
			disabled={primary.kind === 'idle'}
		>
			<span class="hero-icon">
				{#if primary.kind === 'idle'}<Sparkles size={24} strokeWidth={1.75} />
				{:else if primary.kind === 'unread_modmail'}<Mail size={24} strokeWidth={1.75} />
				{:else if primary.kind === 'flagged_user'}<AlertTriangle size={24} strokeWidth={1.75} />
				{:else}<ClipboardList size={24} strokeWidth={1.75} />{/if}
			</span>
			<span class="hero-text">
				<span class="hero-eyebrow">{primary.kind === 'idle' ? 'Inbox zero' : 'Next up'}</span>
				<span class="hero-label">{primary.label}</span>
				<span class="hero-sub">{primary.subtitle}</span>
			</span>
			{#if primary.kind !== 'idle'}<ArrowRight size={20} class="hero-arrow" />{/if}
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

	<!-- Your queue -->
	<div class="tick-rule">Your queue</div>
	<div class="metric-grid">
		<button class="metric paper" use:tilt onclick={() => goto('/dashboard/reviews?tab=all')}>
			<span class="metric-glare" aria-hidden="true"></span>
			<div class="metric-head"><span class="metric-ico ico-sage"><ClipboardList size={15} strokeWidth={1.75} /></span><span class="metric-label">Pending</span></div>
			<CountUp value={metrics.pending} />
			{#if metrics.pendingYours > 0}<span class="metric-sub">{metrics.pendingYours} {metrics.pendingYours === 1 ? 'is' : 'are'} yours</span>{/if}
		</button>
		<button class="metric paper" use:tilt onclick={() => goto('/dashboard/reviews?tab=mine')}>
			<span class="metric-glare" aria-hidden="true"></span>
			<div class="metric-head"><span class="metric-ico"><UserCheck size={15} strokeWidth={1.75} /></span><span class="metric-label">Your claims</span></div>
			<CountUp value={metrics.activeClaims} />
		</button>
		<button class="metric paper" use:tilt onclick={() => goto('/dashboard/stats')}>
			<span class="metric-glare" aria-hidden="true"></span>
			<div class="metric-head"><span class="metric-ico"><CheckCircle size={15} strokeWidth={1.75} /></span><span class="metric-label">Decided today</span></div>
			<CountUp value={metrics.decisionsToday} />
		</button>
		<button class="metric paper" use:tilt onclick={() => goto('/dashboard/stats')}>
			<span class="metric-glare" aria-hidden="true"></span>
			<div class="metric-head"><span class="metric-ico"><Activity size={15} strokeWidth={1.75} /></span><span class="metric-label">This week</span></div>
			<CountUp value={metrics.weekStats.decisions} />
			{#if metrics.weekStats.avgResponseMin != null}<span class="metric-sub">avg {metrics.weekStats.avgResponseMin}m to decide</span>{/if}
		</button>
	</div>

	<!-- Server status -->
	{#if metrics.openModmail != null}
		<div class="tick-rule">Server status</div>
		<div class="metric-grid">
			<button class="metric paper" class:metric-warn={metrics.openModmail > 0} use:tilt onclick={() => goto('/dashboard/modmail?filter=open')}>
				<span class="metric-glare" aria-hidden="true"></span>
				<div class="metric-head"><span class="metric-ico" class:ico-sage={metrics.openModmail > 0}><Mail size={15} strokeWidth={1.75} /></span><span class="metric-label">Open modmail</span></div>
				<CountUp value={metrics.openModmail} />
			</button>
		</div>
	{/if}

	<!-- Activity feed -->
	{#if metrics.recentActivity && metrics.recentActivity.length > 0}
		<div class="tick-rule">Your recent activity</div>
		<ul class="feed">
			{#each metrics.recentActivity as item}
				<li>
					<button class="feed-row" onclick={() => goto(item.href)}>
						<span class="feed-icon {decisionTone(item.action)}">{actionIcon(item)}</span>
						<span class="feed-text">
							{#if item.type === 'decision'}
								<span class="feed-action {decisionTone(item.action)}">{decisionLabel(item.action)}</span>
							{:else}
								<span class="feed-action">Replied</span>
							{/if}
							<span class="feed-subject">{item.subjectName}</span>
						</span>
						<span class="feed-time">{relativeTime(item.createdAt * 1000)}</span>
					</button>
				</li>
			{/each}
		</ul>
	{:else if metrics.openModmail != null}
		<div class="tick-rule">Your recent activity</div>
		<EmptyState message="Quiet shift" subtitle="No recent decisions or modmail replies from you." />
	{/if}

	{#if metrics.openModmail == null && metrics.pending === 0}
		<EmptyState message="All clear" subtitle="No pending applications." />
	{/if}
</SpringReveal>

<style>
	/* Greeting */
	.greet { margin-bottom: 1.4rem; }
	.greet-eyebrow {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--sage-deep);
	}
	.greet-title {
		margin: 0.3rem 0 0;
		font-family: var(--font-head);
		font-size: clamp(1.5rem, 3vw, 2rem);
		font-weight: 600;
		letter-spacing: -0.02em;
		color: var(--ink);
	}
	.greet-sub { margin: 0.4rem 0 0; font-size: 0.95rem; color: var(--ink-2); max-width: 60ch; }

	/* Hero */
	.hero {
		display: flex;
		align-items: center;
		gap: 1.1rem;
		width: 100%;
		text-align: left;
		padding: 1.15rem 1.25rem;
		background: var(--surface);
		border: 1px solid var(--line);
		border-left: 3px solid var(--sage);
		border-radius: var(--radius);
		cursor: pointer;
		margin-bottom: 0.7rem;
		transition: transform var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-smooth);
	}
	.hero:hover:not(:disabled) { transform: translateY(-1px); border-color: var(--sage); }
	.hero:disabled { cursor: default; border-left-color: var(--sage-deep); }
	.hero-idle { border-left-color: var(--sage-deep); }
	.hero-flagged_user { border-left-color: var(--warn); }
	.hero-icon {
		width: 46px; height: 46px;
		display: flex; align-items: center; justify-content: center;
		border-radius: var(--radius);
		background: var(--sage-fill);
		color: var(--sage);
		flex-shrink: 0;
	}
	.hero-text { display: flex; flex-direction: column; flex: 1; gap: 0.15rem; min-width: 0; }
	.hero-eyebrow { font-family: var(--font-mono); font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.14em; color: var(--ink-faint); }
	.hero-label { font-size: 1rem; color: var(--ink); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.hero-sub { font-size: 0.8rem; color: var(--ink-3); }
	:global(.hero-arrow) { color: var(--ink-faint); flex-shrink: 0; }

	.secondary-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.5rem;
		margin-bottom: 0.4rem;
	}
	.secondary {
		text-align: left; padding: 0.7rem 0.9rem;
		background: var(--surface); border: 1px solid var(--line-soft);
		border-radius: var(--radius); cursor: pointer;
		display: flex; flex-direction: column; gap: 0.15rem;
		transition: border-color var(--duration-fast) var(--ease-smooth);
	}
	.secondary:hover { border-color: var(--sage); }
	.sec-label { font-size: 0.85rem; color: var(--ink); font-weight: 500; }
	.sec-sub { font-size: 0.72rem; color: var(--ink-3); }

	/* Tick-rule section divider: rotated-square node + label + dashed hairline */
	.tick-rule {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-family: var(--font-head);
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--ink-3);
		margin: 1.5rem 0 0.75rem;
	}
	.tick-rule::before {
		content: '';
		width: 6px; height: 6px;
		flex-shrink: 0;
		transform: rotate(45deg);
		background: var(--sage-deep);
	}
	.tick-rule::after {
		content: '';
		flex: 1;
		border-top: 1px dashed var(--line);
	}

	/* Metric grid */
	.metric-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.8rem;
	}
	.metric {
		position: relative;
		display: flex; flex-direction: column; gap: 0.25rem;
		padding: 0.9rem 1rem 1rem;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		cursor: pointer; text-align: left;
		overflow: hidden;
		transform-style: preserve-3d;
		transition: transform 120ms var(--ease-out), border-color var(--duration-fast) var(--ease-smooth);
	}
	.metric:hover { border-color: var(--line-strong); }
	.metric-warn { border-color: var(--sage); }
	.metric-glare {
		position: absolute;
		inset: 0;
		border-radius: inherit;
		pointer-events: none;
		opacity: var(--glare, 0);
		transition: opacity var(--duration-fast) var(--ease-smooth);
		background: radial-gradient(220px at var(--mx, 50%) var(--my, 50%), oklch(78% var(--sage-c) var(--sage-h) / 0.14), transparent 60%);
	}
	.metric-head { display: flex; align-items: center; gap: 0.45rem; }
	.metric-ico { display: flex; color: var(--ink-faint); }
	.metric-ico.ico-sage { color: var(--sage); }
	.metric-label {
		font-family: var(--font-mono);
		font-size: 0.6rem; font-weight: 400;
		text-transform: uppercase; letter-spacing: 0.12em;
		color: var(--ink-faint);
	}
	.metric-sub { font-size: 0.72rem; color: var(--ink-3); }

	/* Activity feed */
	.feed { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
	.feed-row {
		display: flex; align-items: center; gap: 0.7rem;
		width: 100%; padding: 0.6rem 0.85rem;
		background: var(--surface); border: 1px solid var(--line-soft);
		border-radius: var(--radius); cursor: pointer; text-align: left;
		transition: border-color var(--duration-fast) var(--ease-smooth);
	}
	.feed-row:hover { border-color: var(--line); }
	.feed-icon {
		width: 26px; height: 26px;
		display: flex; align-items: center; justify-content: center;
		border-radius: var(--radius);
		background: var(--surface-2);
		color: var(--ink-2);
		font-size: 0.85rem;
		flex-shrink: 0;
	}
	.feed-icon.tone-good { background: var(--sage-fill); color: var(--good); }
	.feed-icon.tone-danger { background: oklch(28% 0.06 25); color: oklch(80% 0.12 25); }
	.feed-text { flex: 1; min-width: 0; display: flex; gap: 0.5rem; align-items: baseline; overflow: hidden; }
	.feed-action { font-size: 0.8rem; color: var(--ink); font-weight: 500; flex-shrink: 0; }
	.feed-action.tone-good { color: var(--good); }
	.feed-action.tone-danger { color: oklch(72% 0.12 25); }
	.feed-subject { font-size: 0.8rem; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.feed-time { font-size: 0.72rem; color: var(--ink-faint); flex-shrink: 0; }
</style>
