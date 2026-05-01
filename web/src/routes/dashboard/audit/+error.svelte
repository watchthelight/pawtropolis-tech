<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';

	let status = $derived($page.status);
	let message = $derived($page.error?.message ?? 'Something went wrong loading the audit log.');

	function clearAndRetry() {
		const url = new URL($page.url);
		url.searchParams.delete('q');
		url.searchParams.delete('action');
		url.searchParams.set('page', '1');
		goto(url.toString(), { invalidateAll: true });
	}
</script>

<PageHeader title="Audit" subtitle="Action log" />

<div class="error-card">
	<p class="status">Error {status}</p>
	<p class="message">{message}</p>
	{#if status === 504}
		<p class="hint">
			The audit query exceeded its time budget. Try a narrower date range or remove the search term.
		</p>
	{:else if status === 403}
		<p class="hint">Audit access requires administrator tier.</p>
	{/if}
	<div class="actions">
		<button class="btn" onclick={clearAndRetry}>Reset filters &amp; retry</button>
	</div>
</div>

<style>
	.error-card {
		background: var(--surface);
		border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-md);
		padding: 1.25rem 1.5rem;
		max-width: 42rem;
		margin-top: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.status {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--status-danger);
		margin: 0;
	}
	.message {
		font-size: 0.95rem;
		color: var(--text-primary);
		margin: 0;
	}
	.hint {
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin: 0;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
	}
	.btn {
		padding: 0.45rem 0.9rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-holdfast);
		background: var(--surface-raised);
		color: var(--text-primary);
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		transition: border-color 150ms;
	}
	.btn:hover {
		border-color: var(--accent);
	}
</style>
