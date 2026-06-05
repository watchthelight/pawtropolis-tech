<script lang="ts">
	let { value, label = '' }: {
		value: string;
		label?: string;
	} = $props();

	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function copy() {
		try {
			if (!navigator.clipboard) return;
			await navigator.clipboard.writeText(value);
		} catch {
			return;
		}
		copied = true;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => { copied = false; }, 1500);
	}
</script>

<button class="copyable-id" class:copyable-id-copied={copied} onclick={copy}>
	{#if label}<span class="copyable-id-label">{label}</span>{/if}<span class="copyable-id-value">{value}</span>
	<span class="copyable-id-icon">
		{#if copied}
			<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/></svg>
		{:else}
			<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>
		{/if}
	</span>
	{#if copied}<span class="copyable-id-toast">Copied!</span>{/if}
</button>

<style>
	.copyable-id {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-family: monospace;
		font-size: 0.65rem;
		color: var(--ink-2);
		background: none;
		border: none;
		padding: 0.15rem 0.35rem;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: all 150ms;
		white-space: nowrap;
		position: relative;
	}

	.copyable-id:hover {
		color: var(--ink);
		background: var(--surface-2);
	}

	.copyable-id-copied {
		color: var(--good);
	}

	.copyable-id-copied:hover {
		color: var(--good);
	}

	.copyable-id-label {
		opacity: 0.6;
	}

	.copyable-id-icon {
		display: inline-flex;
		opacity: 0;
		transition: opacity 150ms;
	}

	.copyable-id-icon svg {
		width: 0.7rem;
		height: 0.7rem;
	}

	.copyable-id:hover .copyable-id-icon,
	.copyable-id-copied .copyable-id-icon {
		opacity: 1;
	}

	.copyable-id-toast {
		position: absolute;
		top: -1.5rem;
		left: 50%;
		transform: translateX(-50%);
		font-family: system-ui, sans-serif;
		font-size: 0.6rem;
		font-weight: 600;
		color: var(--good);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 0.1rem 0.4rem;
		white-space: nowrap;
		pointer-events: none;
		animation: toast-pop 150ms ease-out;
	}

	@keyframes toast-pop {
		from { opacity: 0; transform: translateX(-50%) translateY(4px); }
		to { opacity: 1; transform: translateX(-50%) translateY(0); }
	}
</style>
