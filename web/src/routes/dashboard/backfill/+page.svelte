<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import type {
		BackfillStats,
		BackfillChannelRow
	} from '$lib/server/queries/backfill';

	let { data } = $props();

	// SSE seeds these after mount; initial values are a one-shot snapshot.
	// svelte-ignore state_referenced_locally
	let stats = $state<BackfillStats & { messages?: number; reactions?: number; sizeBytes?: number | null }>({
		...data.initialStats,
		messages: data.initialCounts.messages,
		reactions: data.initialCounts.reactions,
		sizeBytes: data.initialCounts.sizeBytes
	});
	// svelte-ignore state_referenced_locally
	let channels = $state<BackfillChannelRow[]>(data.initialChannels);

	let es: EventSource | null = null;
	let connected = $state(false);

	onMount(() => {
		es = new EventSource('/api/backfill/stream');
		es.addEventListener('open', () => {
			connected = true;
		});
		es.addEventListener('error', () => {
			connected = false;
		});
		es.addEventListener('stats', (e) => {
			try {
				stats = JSON.parse((e as MessageEvent).data);
			} catch {
				/* noop */
			}
		});
		es.addEventListener('channels', (e) => {
			try {
				channels = JSON.parse((e as MessageEvent).data);
			} catch {
				/* noop */
			}
		});
	});

	onDestroy(() => {
		es?.close();
	});

	function fmtBytes(b: number | null | undefined): string {
		if (b == null) return '—';
		if (b < 1024) return `${b} B`;
		if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
		if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
		return `${(b / 1024 ** 3).toFixed(2)} GB`;
	}

	function fmtNum(n: number | null | undefined): string {
		if (n == null) return '—';
		return n.toLocaleString();
	}

	function fmtRate(r: number | null | undefined): string {
		if (r == null || Number.isNaN(r)) return '0';
		return r.toFixed(1);
	}

	function fmtEta(s: number | null | undefined): string {
		if (s == null || s <= 0) return '—';
		const d = Math.floor(s / 86400);
		const h = Math.floor((s % 86400) / 3600);
		const m = Math.floor((s % 3600) / 60);
		if (d) return `${d}d ${h}h`;
		if (h) return `${h}h ${m}m`;
		return `${m}m`;
	}

	function fmtUptime(startedAt: number | null | undefined): string {
		if (!startedAt) return '—';
		const elapsed = Math.floor(Date.now() / 1000) - startedAt;
		return fmtEta(elapsed);
	}

	function fmtDate(s: number | null | undefined): string {
		if (!s) return '—';
		const d = new Date(s * 1000);
		return d.toISOString().slice(0, 10);
	}

	const channelsPct = $derived(
		stats.channelsTotal > 0 ? (stats.channelsCompleted / stats.channelsTotal) * 100 : 0
	);
	const diskPct = $derived(
		stats.diskTotalBytes && stats.diskUsedBytes
			? (stats.diskUsedBytes / stats.diskTotalBytes) * 100
			: 0
	);

	function statusColor(s: string): string {
		switch (s) {
			case 'running':
				return 'var(--status-success)';
			case 'pending':
				return 'var(--status-warning)';
			case 'complete':
				return 'var(--accent)';
			case 'error':
				return 'var(--status-danger)';
			case 'skipped':
				return 'var(--text-muted)';
			default:
				return 'var(--text-muted)';
		}
	}

	function processStateColor(s: string): string {
		if (s === 'running') return 'var(--status-success)';
		if (s === 'complete') return 'var(--accent)';
		if (s === 'error') return 'var(--status-danger)';
		if (s === 'paused') return 'var(--status-warning)';
		return 'var(--text-muted)';
	}
</script>

<PageHeader title="Message Backfill" subtitle="Live archive ingestion telemetry" />

<section class="wrap">
	<div class="hero">
		<div class="state-chip" style="--c: {processStateColor(stats.processState)}">
			<span class="dot" class:pulse={stats.processState === 'running'}></span>
			<span class="label">{stats.processState}</span>
		</div>
		<div class="hero-stat">
			<span class="big">{fmtRate(stats.msgsPerSec)}</span>
			<span class="unit">msgs / sec</span>
		</div>
		<div class="meta">
			<span class:ok={connected} class:bad={!connected}>
				{connected ? 'live' : 'reconnecting…'}
			</span>
			<span>elapsed {fmtUptime(stats.startedAt)}</span>
			<span>eta {fmtEta(stats.etaSeconds)}</span>
		</div>
	</div>

	<div class="grid">
		<div class="card">
			<div class="card-label">Channels</div>
			<div class="card-value">{stats.channelsCompleted} / {stats.channelsTotal}</div>
			<div class="bar">
				<div class="bar-fill" style="width: {channelsPct}%"></div>
			</div>
			<div class="card-sub">{channelsPct.toFixed(1)}% done</div>
		</div>

		<div class="card">
			<div class="card-label">Messages logged</div>
			<div class="card-value">{fmtNum(stats.messagesTotal)}</div>
			<div class="card-sub">total archived: {fmtNum(stats.messages)}</div>
		</div>

		<div class="card">
			<div class="card-label">Reactions logged</div>
			<div class="card-value">{fmtNum(stats.reactionsTotal)}</div>
			<div class="card-sub">total archived: {fmtNum(stats.reactions)}</div>
		</div>

		<div class="card">
			<div class="card-label">Archive size (tables)</div>
			<div class="card-value">{fmtBytes(stats.sizeBytes)}</div>
			<div class="card-sub">on-disk pages</div>
		</div>

		<div class="card">
			<div class="card-label">Disk</div>
			<div class="card-value">{fmtBytes(stats.diskUsedBytes)} / {fmtBytes(stats.diskTotalBytes)}</div>
			<div class="bar">
				<div class="bar-fill" class:warn={diskPct > 70} class:danger={diskPct > 90} style="width: {Math.min(100, diskPct)}%"></div>
			</div>
			<div class="card-sub">{diskPct.toFixed(1)}%</div>
		</div>

		<div class="card">
			<div class="card-label">Current channel</div>
			<div class="card-value mono">{stats.currentChannelName ?? '—'}</div>
			<div class="card-sub mono">{stats.currentChannelId ?? '—'}</div>
		</div>
	</div>

	<h2 class="section-title">Per-channel progress</h2>
	<div class="table">
		<div class="row head">
			<div>Channel</div>
			<div>Status</div>
			<div class="right">Messages</div>
			<div class="right">Reactions</div>
			<div>Range</div>
			<div>Updated</div>
		</div>
		{#each channels as ch (ch.channelId)}
			<div class="row" class:running={ch.status === 'running'}>
				<div class="mono ellipsis" title={ch.channelId}>#{ch.channelName}</div>
				<div>
					<span class="status-pill" style="--c: {statusColor(ch.status)}">
						<span class="dot small" class:pulse={ch.status === 'running'}></span>
						{ch.status}
					</span>
				</div>
				<div class="right">{fmtNum(ch.messagesFetched)}</div>
				<div class="right">{fmtNum(ch.reactionsFetched)}</div>
				<div class="mono">{fmtDate(ch.oldestSeenTs)} → {fmtDate(ch.newestSeenTs)}</div>
				<div class="mono">{fmtDate(ch.updatedAt)}</div>
			</div>
			{#if ch.lastError}
				<div class="row err">
					<div></div>
					<div class="span" style="grid-column: 2 / -1">error: <span class="mono">{ch.lastError}</span></div>
				</div>
			{/if}
		{/each}
	</div>
</section>

<style>
	.wrap {
		max-width: 1100px;
		margin: 0 auto;
		padding: 1rem;
	}

	.hero {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 1.5rem;
		padding: 1.25rem 1.5rem;
		border-radius: 14px;
		background: var(--surface);
		border: 1px solid var(--border);
		margin-bottom: 1rem;
	}

	.state-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.75rem;
		border-radius: 999px;
		background: color-mix(in oklch, var(--c) 12%, transparent);
		color: var(--c);
		font-weight: 600;
		text-transform: lowercase;
		font-size: 0.85rem;
		letter-spacing: 0.02em;
		border: 1px solid color-mix(in oklch, var(--c) 30%, transparent);
	}

	.dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: currentColor;
	}
	.dot.small { width: 0.4rem; height: 0.4rem; }
	.dot.pulse {
		animation: pulse 1.4s ease-in-out infinite;
	}
	@keyframes pulse {
		0%, 100% { opacity: 1; transform: scale(1); }
		50% { opacity: 0.5; transform: scale(1.4); }
	}

	.hero-stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.1rem;
	}
	.big {
		font-size: 2.5rem;
		font-weight: 700;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}
	.unit {
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-muted);
	}

	.meta {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.2rem;
		font-size: 0.85rem;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.meta .ok { color: var(--status-success); }
	.meta .bad { color: var(--status-warning); }

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}

	.card {
		padding: 1rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.card-label {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-muted);
	}
	.card-value {
		font-size: 1.4rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}
	.card-sub {
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	.bar {
		height: 6px;
		background: var(--border);
		border-radius: 999px;
		overflow: hidden;
	}
	.bar-fill {
		height: 100%;
		background: var(--accent);
		transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
	}
	.bar-fill.warn { background: var(--status-warning); }
	.bar-fill.danger { background: var(--status-danger); }

	.section-title {
		margin: 1.5rem 0 0.75rem;
		font-size: 1rem;
		font-weight: 600;
		color: var(--text);
	}

	.table {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		overflow: hidden;
	}
	.row {
		display: grid;
		grid-template-columns: 2.2fr 1fr 1fr 1fr 1.6fr 1fr;
		gap: 0.75rem;
		padding: 0.6rem 0.9rem;
		font-size: 0.85rem;
		border-bottom: 1px solid var(--border);
		align-items: center;
	}
	.row:last-child { border-bottom: none; }
	.row.head {
		font-weight: 600;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
		background: color-mix(in oklch, var(--surface) 70%, var(--border));
	}
	.row.running {
		background: color-mix(in oklch, var(--status-success) 6%, transparent);
	}
	.row.err {
		padding: 0.3rem 0.9rem 0.6rem;
		font-size: 0.75rem;
		color: var(--status-danger);
		border-bottom: 1px solid var(--border);
	}

	.right { text-align: right; font-variant-numeric: tabular-nums; }
	.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.78rem; }
	.ellipsis {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.status-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		font-size: 0.72rem;
		text-transform: lowercase;
		font-weight: 600;
		background: color-mix(in oklch, var(--c) 14%, transparent);
		color: var(--c);
		border: 1px solid color-mix(in oklch, var(--c) 30%, transparent);
	}
</style>
