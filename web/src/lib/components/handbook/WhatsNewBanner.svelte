<script lang="ts">
	import { onMount } from 'svelte';
	import type { WhatsNewEntry } from '$lib/handbook-shared';

	type Props = { entries: WhatsNewEntry[]; compact?: boolean };
	let { entries, compact = false }: Props = $props();

	const STORAGE_KEY = 'pt.handbook.whatsnew.dismissed';

	// Keyed by the newest marker date, so dismissing today's drop does not hide next
	// week's. Anything newer than what was dismissed brings the banner back.
	let newestSince = $derived(entries.length ? entries[0].since : null);
	let dismissedAt = $state<string | null>(null);
	let mounted = $state(false);

	onMount(() => {
		try {
			dismissedAt = localStorage.getItem(STORAGE_KEY);
		} catch {
			dismissedAt = null;
		}
		mounted = true;
	});

	function dismiss() {
		dismissedAt = newestSince;
		try {
			if (newestSince) localStorage.setItem(STORAGE_KEY, newestSince);
		} catch {
			// Private mode or storage disabled: the banner just returns next load.
		}
	}

	// Render nothing until mounted so the server pass and the first client pass agree.
	let visible = $derived(
		mounted && entries.length > 0 && (!dismissedAt || !newestSince || dismissedAt < newestSince)
	);
</script>

{#if visible}
	<aside class="wn" class:wn-compact={compact} aria-label="Recently added to the handbook">
		<div class="wn-head">
			<span class="wn-tag">New this week</span>
			<button class="wn-x" onclick={dismiss} aria-label="Dismiss">
				<svg viewBox="0 0 16 16" aria-hidden="true">
					<path
						fill="currentColor"
						d="M4.3 3.3 8 7l3.7-3.7 1 1L9 8l3.7 3.7-1 1L8 9l-3.7 3.7-1-1L7 8 3.3 4.3z"
					/>
				</svg>
			</button>
		</div>
		<ul class="wn-list">
			{#each entries as entry (entry.href)}
				<li>
					<a href={entry.href}>
						<span class="wn-item">{entry.headingText}</span>
						<span class="wn-doc">{entry.docTitle}</span>
					</a>
				</li>
			{/each}
		</ul>
	</aside>
{/if}

<style>
	.wn {
		margin: 0 0 1.4rem;
		padding: 0.9rem 1rem;
		border-radius: var(--radius-md);
		border: 1px solid oklch(50% 0.11 85);
		background: linear-gradient(
			to bottom,
			oklch(26% 0.07 85 / 0.55),
			oklch(22% 0.04 85 / 0.35)
		);
	}
	.wn-compact {
		margin-bottom: 1rem;
		padding: 0.7rem 0.85rem;
	}
	.wn-head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 0.5rem;
	}
	.wn-tag {
		font-size: 0.74rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: oklch(82% 0.13 85);
	}
	.wn-x {
		margin-left: auto;
		display: inline-flex;
		padding: 0.2rem;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink-3);
		cursor: pointer;
		transition: color 0.15s ease;
	}
	.wn-x:hover {
		color: var(--ink);
	}
	.wn-x svg {
		width: 0.9rem;
		height: 0.9rem;
	}
	.wn-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.wn-list a {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		flex-wrap: wrap;
		padding: 0.25rem 0.35rem;
		margin: 0 -0.35rem;
		border-radius: var(--radius-sm);
		text-decoration: none;
		color: var(--ink);
		transition: background 0.15s ease;
	}
	.wn-list a:hover {
		background: oklch(100% 0 0 / 0.05);
	}
	.wn-item {
		font-weight: 600;
	}
	.wn-doc {
		font-size: 0.8rem;
		color: var(--ink-3);
	}
</style>
