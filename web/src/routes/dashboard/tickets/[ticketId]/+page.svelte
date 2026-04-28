<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let activeTab = $state<'transcript' | 'staff' | 'timeline' | 'attachments'>(
		'transcript'
	);

	const channelMessages = $derived(data.messages.filter((m) => !m.inThread));
	const threadMessages = $derived(data.messages.filter((m) => m.inThread));

	function fmtDate(unix: number): string {
		return new Date(unix * 1000).toLocaleString();
	}
	function fmtSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function attachmentHref(a: typeof data.attachments[number]): string {
		if (a.hasLocalMirror) {
			return `/api/tickets/${data.ticket.id}/attachments/${a.id}`;
		}
		return a.originalUrl;
	}
</script>

<div class="page">
	<header class="ticket-header">
		<a class="back" href="/dashboard/tickets">← Back to list</a>
		<h1>
			<span
				class="type-pill"
				style:background-color={`#${data.ticket.typeEmbedColor.toString(16).padStart(6, '0')}`}>
				{data.ticket.typeLabel}
			</span>
			#{String(data.ticket.number).padStart(4, '0')}
		</h1>
		<div class="meta">
			<span><strong>Opener:</strong> <code>{data.ticket.openerUserId}</code></span>
			<span>
				<strong>Claimer:</strong>
				{#if data.ticket.claimedByUserId}
					<code>{data.ticket.claimedByUserId}</code>
				{:else}
					<em>unclaimed</em>
				{/if}
			</span>
			<span><strong>Status:</strong> <span class={`status status-${data.ticket.status}`}>{data.ticket.status}</span></span>
			<span><strong>Opened:</strong> {fmtDate(data.ticket.openedAt)}</span>
			{#if data.ticket.closedAt}
				<span><strong>Closed:</strong> {fmtDate(data.ticket.closedAt)}</span>
			{/if}
			{#if data.ticket.closeReason}
				<span class="close-reason"><strong>Close reason:</strong> {data.ticket.closeReason}</span>
			{/if}
			{#if data.ticket.legacySource}
				<span class="legacy">Legacy: {data.ticket.legacySource}</span>
			{/if}
		</div>
	</header>

	<nav class="tabs">
		<button class:active={activeTab === 'transcript'} onclick={() => (activeTab = 'transcript')}>
			Transcript ({channelMessages.length})
		</button>
		{#if data.canSeeStaffNotes}
			<button class:active={activeTab === 'staff'} onclick={() => (activeTab = 'staff')}>
				Staff notes ({threadMessages.length})
			</button>
		{/if}
		<button class:active={activeTab === 'timeline'} onclick={() => (activeTab = 'timeline')}>
			Timeline ({data.events.length})
		</button>
		<button class:active={activeTab === 'attachments'} onclick={() => (activeTab = 'attachments')}>
			Attachments ({data.attachments.length})
		</button>
	</nav>

	{#if activeTab === 'transcript' || activeTab === 'staff'}
		{@const msgs = activeTab === 'transcript' ? channelMessages : threadMessages}
		<section class="transcript">
			{#each msgs as m (m.id)}
				<div class={`msg ${m.deletedAt ? 'deleted' : ''}`}>
					<div class="msg-head">
						<code class="author">{m.authorUserId}{m.authorIsBot ? ' [BOT]' : ''}</code>
						<span class="ts">{fmtDate(m.createdAt)}</span>
						{#if m.editedAt}
							<span class="edited">(edited {fmtDate(m.editedAt)})</span>
						{/if}
						{#if m.deletedAt}
							<span class="deleted-marker">(deleted {fmtDate(m.deletedAt)})</span>
						{/if}
					</div>
					{#if m.content}
						<p class="content">{m.content}</p>
					{/if}
					{#if m.embeds && Array.isArray(m.embeds) && m.embeds.length > 0}
						<div class="embeds">
							{#each m.embeds as embed, i (i)}
								{@const e = embed as { title?: string; description?: string; color?: number; fields?: Array<{ name: string; value: string }> }}
								<div class="embed" style:border-left-color={e.color ? `#${e.color.toString(16).padStart(6, '0')}` : '#888'}>
									{#if e.title}<strong>{e.title}</strong>{/if}
									{#if e.description}<p>{e.description}</p>{/if}
									{#if e.fields && e.fields.length > 0}
										<dl>
											{#each e.fields as f, fi (fi)}
												<dt>{f.name}</dt>
												<dd>{f.value}</dd>
											{/each}
										</dl>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{:else}
				<p class="empty">No messages.</p>
			{/each}
		</section>
	{:else if activeTab === 'timeline'}
		<section class="timeline">
			{#each data.events as e (e.id)}
				<div class="event">
					<span class="event-type">{e.eventType}</span>
					<span class="ts">{fmtDate(e.createdAt)}</span>
					{#if e.actorUserId}
						<code class="actor">{e.actorUserId}</code>
					{/if}
					{#if e.payload}
						<pre class="payload">{JSON.stringify(e.payload, null, 2)}</pre>
					{/if}
				</div>
			{:else}
				<p class="empty">No events recorded.</p>
			{/each}
		</section>
	{:else if activeTab === 'attachments'}
		<section class="attachments">
			{#each data.attachments as a (a.id)}
				<a class="attachment-card" href={attachmentHref(a)} target="_blank" rel="noopener">
					<span class="filename">{a.filename}</span>
					<span class="size">{fmtSize(a.sizeBytes)}</span>
					{#if !a.hasLocalMirror}
						<span class="warn">⚠ unmirrored — Discord URL may have expired</span>
					{/if}
				</a>
			{:else}
				<p class="empty">No attachments.</p>
			{/each}
		</section>
	{/if}
</div>

<style>
	.page {
		padding: 1.5rem;
		display: grid;
		gap: 1rem;
	}
	.back {
		text-decoration: none;
		font-size: 0.875rem;
		color: var(--text-muted, #888);
	}
	.ticket-header h1 {
		margin: 0.25rem 0;
		display: flex;
		gap: 0.75rem;
		align-items: center;
		font-size: 1.5rem;
	}
	.type-pill {
		display: inline-block;
		padding: 0.25rem 0.65rem;
		border-radius: 999px;
		color: #fff;
		font-size: 0.85rem;
		font-weight: 600;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		font-size: 0.875rem;
		color: var(--text-secondary, #aaa);
	}
	.close-reason {
		flex-basis: 100%;
	}
	.legacy {
		color: #facc15;
	}
	.status-open {
		color: #4ade80;
		font-weight: 600;
	}
	.status-closed {
		color: #94a3b8;
		font-weight: 600;
	}
	.tabs {
		display: flex;
		gap: 0.5rem;
		border-bottom: 1px solid var(--border, #333);
	}
	.tabs button {
		background: transparent;
		border: none;
		color: var(--text-secondary, #aaa);
		padding: 0.5rem 1rem;
		font-size: 0.9rem;
		cursor: pointer;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
	}
	.tabs button.active {
		color: var(--text-primary, #fff);
		border-bottom-color: var(--accent, #5865F2);
	}
	.transcript,
	.timeline,
	.attachments {
		display: grid;
		gap: 0.75rem;
	}
	.msg {
		padding: 0.75rem 1rem;
		background: var(--surface, #1c1c1c);
		border-radius: var(--radius-md, 12px);
	}
	.msg.deleted {
		opacity: 0.5;
		text-decoration: line-through;
	}
	.msg-head {
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
		font-size: 0.8rem;
		color: var(--text-muted, #888);
	}
	.msg-head .author {
		color: var(--text-primary, #fff);
		font-weight: 600;
	}
	.edited,
	.deleted-marker {
		font-style: italic;
	}
	.msg .content {
		margin: 0.4rem 0 0;
		white-space: pre-wrap;
		font-size: 0.95rem;
	}
	.embeds {
		display: grid;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	.embed {
		border-left: 4px solid #888;
		padding: 0.5rem 0.75rem;
		background: var(--surface-raised, #2a2a2a);
		border-radius: var(--radius-sm, 6px);
		font-size: 0.875rem;
	}
	.embed dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.25rem 0.75rem;
		margin: 0.4rem 0 0;
	}
	.embed dt {
		font-weight: 600;
	}
	.embed dd {
		margin: 0;
	}
	.event {
		display: grid;
		grid-template-columns: max-content max-content max-content 1fr;
		gap: 0.75rem;
		align-items: baseline;
		padding: 0.5rem 0.75rem;
		background: var(--surface, #1c1c1c);
		border-radius: var(--radius-sm, 6px);
		font-size: 0.875rem;
	}
	.event-type {
		font-weight: 600;
		font-family: ui-monospace, monospace;
		color: var(--accent, #5865F2);
	}
	.event .ts {
		color: var(--text-muted, #888);
		font-size: 0.8rem;
	}
	.event .actor {
		font-size: 0.8rem;
	}
	.event .payload {
		grid-column: 1 / -1;
		margin: 0.25rem 0 0;
		font-size: 0.75rem;
		background: var(--surface-raised, #2a2a2a);
		padding: 0.4rem 0.6rem;
		border-radius: 4px;
		overflow-x: auto;
	}
	.attachment-card {
		display: flex;
		gap: 1rem;
		align-items: center;
		padding: 0.75rem 1rem;
		background: var(--surface, #1c1c1c);
		border-radius: var(--radius-md, 12px);
		text-decoration: none;
		color: inherit;
	}
	.attachment-card:hover {
		background: var(--surface-raised, #2a2a2a);
	}
	.attachment-card .filename {
		font-weight: 600;
	}
	.attachment-card .size {
		color: var(--text-muted, #888);
		font-size: 0.875rem;
	}
	.attachment-card .warn {
		color: #facc15;
		font-size: 0.8rem;
		margin-left: auto;
	}
	.empty {
		text-align: center;
		padding: 2rem;
		color: var(--text-muted, #888);
	}
	code {
		font-size: 0.85rem;
	}
</style>
