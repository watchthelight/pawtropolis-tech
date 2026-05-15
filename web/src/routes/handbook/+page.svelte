<script lang="ts">
	import { TIER_LABELS } from '$lib/server/roles';

	let { data } = $props();
	let user = $derived(data.user);
	let docs = $derived(data.docs);
	let tier = $derived(data.tier);

	const STARTER: Record<string, string> = {
		owner: 'leadership-guide',
		cm: 'leadership-guide',
		cdl: 'leadership-guide',
		sa: 'admin-guide',
		admin: 'admin-guide',
		sm: 'moderator-guide',
		mod: 'moderator-guide',
		jm: 'gatekeeper-guide',
		gk: 'gatekeeper-guide',
		viewer: 'mod-quickref',
		none: 'bot-handbook'
	};
	let starterSlug = $derived(tier ? STARTER[tier] ?? 'bot-handbook' : 'bot-handbook');
	let starterTitle = $derived(docs.find((d: { slug: string }) => d.slug === starterSlug)?.title ?? 'Bot Handbook');
</script>

<svelte:head>
	<title>Handbook · Pawtropolis Tech</title>
	<meta
		name="description"
		content="Permission-aware handbook for the Pawtropolis Discord bot."
	/>
</svelte:head>

<article class="hb-landing">
	<header class="hb-landing-head">
		<h1>Pawtropolis Handbook</h1>
		<p class="hb-tagline">
			Every command, every policy, every escalation. Filtered by what your Discord role can
			actually run.
		</p>
	</header>

	<section class="hb-landing-tier">
		{#if user}
			<div class="hb-tier-card">
				<span class="hb-tier-card-label">Signed in as</span>
				<strong class="hb-tier-card-name">{user.globalName ?? user.username}</strong>
				<span class="hb-tier-card-tier">{TIER_LABELS[user.tier as keyof typeof TIER_LABELS] ?? 'Signed in'}</span>
			</div>
			<a class="hb-landing-cta" href={`/handbook/${starterSlug}`}>
				Start with the {starterTitle}
			</a>
		{:else}
			<div class="hb-tier-card hb-tier-card-out">
				<span class="hb-tier-card-label">Not signed in</span>
				<strong class="hb-tier-card-name">Reading public content only</strong>
				<span class="hb-tier-card-tier">
					Sign in with Discord to unlock staff-only sections.
				</span>
			</div>
			<a class="hb-landing-cta" href="/auth/login?return=/handbook">Sign in with Discord</a>
		{/if}
	</section>

	<section class="hb-landing-docs">
		<h2>All documents</h2>
		<ul class="hb-doc-grid">
			{#each docs as doc (doc.slug)}
				<li>
					<a class="hb-doc-card" class:locked={doc.isLockedForLoggedOut} href={`/handbook/${doc.slug}`}>
						<h3>{doc.title}</h3>
						<p>{doc.tagline}</p>
						{#if doc.isLockedForLoggedOut}
							<span class="hb-doc-lock">Sign in to read</span>
						{/if}
					</a>
				</li>
			{/each}
		</ul>
	</section>
</article>

<style>
	.hb-landing {
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}
	.hb-landing-head h1 {
		margin: 0;
		font-size: clamp(2rem, 5vw, 3rem);
		color: var(--text-primary);
		letter-spacing: -0.02em;
	}
	.hb-tagline {
		margin: 0.4rem 0 0;
		color: var(--text-secondary);
		font-size: 1.05rem;
		max-width: 60ch;
	}
	.hb-landing-tier {
		display: flex;
		align-items: center;
		gap: 1.2rem;
		flex-wrap: wrap;
	}
	.hb-tier-card {
		flex: 1;
		min-width: 18rem;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 1rem 1.2rem;
		border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-md);
		background: var(--surface);
	}
	.hb-tier-card-out {
		border-style: dashed;
	}
	.hb-tier-card-label {
		font-size: 0.74rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-tertiary);
	}
	.hb-tier-card-name {
		font-size: 1.15rem;
		color: var(--text-primary);
	}
	.hb-tier-card-tier {
		font-size: 0.92rem;
		color: var(--accent);
	}
	.hb-landing-cta {
		display: inline-flex;
		align-items: center;
		padding: 0.7em 1.4em;
		border-radius: var(--radius-md);
		background: var(--accent);
		color: var(--text-on-accent);
		font-weight: 600;
		text-decoration: none;
		min-height: 44px;
	}
	.hb-landing-cta:hover {
		background: var(--accent-strong);
	}
	.hb-landing-docs h2 {
		margin: 0 0 0.8rem;
		font-size: 1.4rem;
		color: var(--text-primary);
	}
	.hb-doc-grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
		gap: 0.8rem;
	}
	.hb-doc-card {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0.9rem 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
		text-decoration: none;
		color: inherit;
		transition: border-color 0.15s ease, transform 0.15s ease;
	}
	.hb-doc-card:hover {
		border-color: var(--accent-dim);
		transform: translateY(-1px);
	}
	.hb-doc-card h3 {
		margin: 0;
		color: var(--text-primary);
		font-size: 1.02rem;
	}
	.hb-doc-card p {
		margin: 0;
		font-size: 0.88rem;
		color: var(--text-tertiary);
	}
	.hb-doc-card.locked {
		opacity: 0.78;
	}
	.hb-doc-lock {
		font-size: 0.76rem;
		color: var(--accent);
		font-weight: 600;
	}
</style>
