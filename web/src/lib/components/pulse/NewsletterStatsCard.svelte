<script lang="ts">
	import type { NewsletterStats, GuildSnapshot, TopVoiceChannel } from '$lib/server/queries/pulse';
	import { onDestroy } from 'svelte';
	import { fade } from 'svelte/transition';
	import { Copy, Check } from 'lucide-svelte';

	let { stats, guildSnapshot = null, topVoiceChannels = [] }: {
		stats: NewsletterStats;
		guildSnapshot?: GuildSnapshot | null;
		topVoiceChannels?: TopVoiceChannel[];
	} = $props();

	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | undefined;

	// ── Delta computation ──

	interface Delta {
		pctChange: string;
		absChange: string;
		direction: 'up' | 'down' | 'flat';
		emoji: string;
	}

	const UP_EMOJI = '<:Iup_Vote:1363727092898074664>';
	const DOWN_EMOJI = '<:Idown_Vote:1363727105967525928>';
	const NEUTRAL_EMOJI = '➖';

	function numDelta(cur: number, prev: number): Delta {
		if (prev === 0 && cur === 0) return { pctChange: '0.0', absChange: '0', direction: 'flat', emoji: NEUTRAL_EMOJI };
		if (prev === 0) return { pctChange: '+\u221e', absChange: `+${cur.toLocaleString()}`, direction: 'up', emoji: UP_EMOJI };
		const pct = ((cur - prev) / prev) * 100;
		const abs = cur - prev;
		return {
			pctChange: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}`,
			absChange: `${abs >= 0 ? '+' : ''}${abs.toLocaleString()}`,
			direction: abs > 0 ? 'up' : abs < 0 ? 'down' : 'flat',
			emoji: abs > 0 ? UP_EMOJI : abs < 0 ? DOWN_EMOJI : NEUTRAL_EMOJI
		};
	}

	function pctDelta(cur: number, prev: number): Delta {
		// For retention (already a percentage): absolute change is pp, relative change is %
		const ppDiff = cur - prev;
		if (prev === 0 && cur === 0) return { pctChange: '0.0', absChange: '0.0%', direction: 'flat', emoji: NEUTRAL_EMOJI };
		if (prev === 0) return { pctChange: '+\u221e', absChange: `+${cur.toFixed(1)}%`, direction: 'up', emoji: UP_EMOJI };
		const relChange = ((cur - prev) / prev) * 100;
		return {
			pctChange: `${relChange >= 0 ? '+' : ''}${relChange.toFixed(1)}`,
			absChange: `${ppDiff >= 0 ? '+' : ''}${ppDiff.toFixed(1)}%`,
			direction: ppDiff > 0 ? 'up' : ppDiff < 0 ? 'down' : 'flat',
			emoji: ppDiff > 0 ? UP_EMOJI : ppDiff < 0 ? DOWN_EMOJI : NEUTRAL_EMOJI
		};
	}

	let deltas = $derived({
		newMembers: numDelta(stats.current.newMembers, stats.previous.newMembers),
		retention: pctDelta(stats.current.retentionPct, stats.previous.retentionPct),
		newCommunicators: numDelta(stats.current.newCommunicators, stats.previous.newCommunicators),
		communicators: numDelta(stats.current.communicators, stats.previous.communicators),
		totalMessages: numDelta(stats.current.totalMessages, stats.previous.totalMessages),
		voiceMinutes: numDelta(stats.current.voiceMinutes, stats.previous.voiceMinutes)
	});

	// Show "Awaiting data" only when tracking just started and there's zero data
	let voiceAwaiting = $derived(
		!stats.voiceTrackingActive && stats.current.voiceMinutes === 0 && stats.previous.voiceMinutes === 0
	);

	// ── Discord markdown output ──

	let discordMarkdown = $derived.by(() => {
		const d = deltas;
		const c = stats.current;
		const voiceLine = voiceAwaiting
			? `> ### — Total voice minutes\n> -# Awaiting data`
			: `> ### ${c.voiceMinutes.toLocaleString()} Total voice minutes\n> -# ${d.voiceMinutes.emoji} ${d.voiceMinutes.pctChange}% (${d.voiceMinutes.absChange}) compared to last week`;

		// Server Vitals section (only if snapshot data available)
		const gs = guildSnapshot;
		const vitalsSection = gs
			? `> \u2068\`Server Vitals\`\u2069\u2069\n> ### ${gs.memberCount.toLocaleString()} Total Members\n> -# ${gs.onlineCount !== null ? gs.onlineCount.toLocaleString() + ' currently online' : 'Online count unavailable'} \u2022 Level ${gs.boostTier} (${gs.boostCount} boosts)\n`
			: '';

		// Top voice channels (only if data available)
		const voiceChannels = topVoiceChannels.filter(ch => ch.minutes > 0);
		const topVoiceLine = voiceChannels.length > 0
			? `> \u2068\`Top Voice Channels\`\u2069\u2069\n> -# \uD83D\uDD0A ${voiceChannels.map(ch => `${ch.channelName ? ch.channelName : ch.channelId}: ${ch.minutes.toLocaleString()} min`).join(' \u2022 ')}\n`
			: '';

		return `## <a:StarShower:948003038499586068> Stats Overview
${vitalsSection}> \u2068\`Growth & Activation\`\u2069\u2069
> ### ${c.newMembers.toLocaleString()} New members
> -# ${d.newMembers.emoji} ${d.newMembers.pctChange}% (${d.newMembers.absChange}) compared to last week
> ### ${c.retentionPct.toFixed(1)}% New Member Retention
> -# ${d.retention.emoji} ${d.retention.pctChange}% (${d.retention.absChange}) compared to last week
> ### ${c.newCommunicators.toLocaleString()} New Communicators
> -# ${d.newCommunicators.emoji} ${d.newCommunicators.pctChange}% (${d.newCommunicators.absChange}) compared to last week
> \u2068\`Engagement\`\u2069\u2069
> ### ${c.communicators.toLocaleString()} Communicators
> -# ${d.communicators.emoji} ${d.communicators.pctChange}% (${d.communicators.absChange}) compared to last week
> ### ${c.totalMessages.toLocaleString()} Total messages sent
> -# ${d.totalMessages.emoji} ${d.totalMessages.pctChange}% (${d.totalMessages.absChange}) compared to last week
${voiceLine}
${topVoiceLine}`.trimEnd();
	});

	// ── Preview data for human-readable display ──

	interface PreviewRow { label: string; value: string; delta: Delta | null; section?: string; }
	let previewRows = $derived<PreviewRow[]>([
		...(guildSnapshot ? [
			{ label: 'Total Members', value: guildSnapshot.memberCount.toLocaleString(), delta: null as Delta | null, section: 'Server Vitals' },
			{ label: 'Online Now', value: guildSnapshot.onlineCount !== null ? guildSnapshot.onlineCount.toLocaleString() : '—', delta: null as Delta | null },
			{ label: 'Boost Status', value: `Level ${guildSnapshot.boostTier} (${guildSnapshot.boostCount})`, delta: null as Delta | null },
		] : []),
		{ label: 'New Members', value: stats.current.newMembers.toLocaleString(), delta: deltas.newMembers, section: 'Growth & Activation' },
		{ label: 'New Member Retention', value: `${stats.current.retentionPct.toFixed(1)}%`, delta: deltas.retention },
		{ label: 'New Communicators', value: stats.current.newCommunicators.toLocaleString(), delta: deltas.newCommunicators },
		{ label: 'Communicators', value: stats.current.communicators.toLocaleString(), delta: deltas.communicators, section: 'Engagement' },
		{ label: 'Total Messages', value: stats.current.totalMessages.toLocaleString(), delta: deltas.totalMessages },
		{ label: 'Voice Minutes', value: voiceAwaiting ? 'Awaiting data' : stats.current.voiceMinutes.toLocaleString(), delta: voiceAwaiting ? null : deltas.voiceMinutes },
	]);

	onDestroy(() => { if (copyTimer) clearTimeout(copyTimer); });

	async function copyToClipboard() {
		try {
			await navigator.clipboard.writeText(discordMarkdown);
			copied = true;
			if (copyTimer) clearTimeout(copyTimer);
			copyTimer = setTimeout(() => { copied = false; }, 2000);
		} catch {
			// Fallback for non-secure contexts
		}
	}
</script>

<div class="newsletter-card" transition:fade={{ duration: 200 }}>
	<div class="newsletter-header">
		<span class="newsletter-title">Newsletter Stats</span>
		<button class="copy-btn" onclick={copyToClipboard} class:copied>
			{#if copied}
				<Check size={14} />
				<span>Copied!</span>
			{:else}
				<Copy size={14} />
				<span>Copy for Newsletter</span>
			{/if}
		</button>
	</div>

	<div class="newsletter-grid">
		{#each previewRows as row}
			{#if row.section}
				<div class="newsletter-section-label">{row.section}</div>
			{/if}
			<div class="newsletter-row">
				<span class="row-label">{row.label}</span>
				<span class="row-value">{row.value}</span>
				{#if row.delta}
					<span class="row-delta" class:delta-up={row.delta.direction === 'up'} class:delta-down={row.delta.direction === 'down'}>
						{row.delta.direction === 'up' ? '\u2191' : row.delta.direction === 'down' ? '\u2193' : '\u2014'}
						{row.delta.pctChange}%
					</span>
				{:else}
					<span class="row-delta row-na"></span>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.newsletter-card {
		background: var(--surface);
		border: 1px solid var(--line-soft);
		border-radius: var(--radius-md);
		padding: var(--space-card);
		box-shadow: var(--shadow-sm);
	}

	.newsletter-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.newsletter-title {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--ink-3);
	}

	.copy-btn {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.75rem;
		background: var(--sage-soft);
		color: var(--sage);
		border: 1px solid oklch(50% 0.04 var(--hue) / 0.3);
		border-radius: var(--radius-sm);
		font-size: 0.7rem;
		font-weight: 600;
		cursor: pointer;
		transition: all var(--duration-fast) var(--ease-smooth);
	}

	.copy-btn:hover {
		background: var(--sage-deep);
		border-color: var(--sage);
	}

	.copy-btn.copied {
		background: oklch(65% 0.15 145 / 0.15);
		color: var(--good);
		border-color: oklch(65% 0.15 145 / 0.3);
	}

	.newsletter-grid {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.newsletter-section-label {
		font-size: 0.6rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--ink-faint);
		margin-top: 0.5rem;
		margin-bottom: 0.15rem;
	}

	.newsletter-section-label:first-child {
		margin-top: 0;
	}

	.newsletter-row {
		display: grid;
		grid-template-columns: 1fr auto auto;
		gap: 0.75rem;
		align-items: center;
		padding: 0.35rem 0.5rem;
		border-radius: var(--radius-sm);
		transition: background var(--duration-fast) var(--ease-smooth);
	}

	.newsletter-row:hover {
		background: var(--hover-bg);
	}

	.row-label {
		font-size: 0.75rem;
		color: var(--ink-2);
	}

	.row-value {
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--ink);
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.row-delta {
		font-size: 0.7rem;
		font-weight: 600;
		min-width: 5rem;
		text-align: right;
		font-variant-numeric: tabular-nums;
		color: var(--ink-3);
	}

	.delta-up { color: var(--good); }
	.delta-down { color: var(--danger); }
	.row-na { color: var(--ink-faint); }
</style>
