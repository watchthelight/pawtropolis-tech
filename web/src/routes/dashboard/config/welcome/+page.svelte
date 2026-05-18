<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import WelcomeMessageEditor from '$lib/components/config/WelcomeMessageEditor.svelte';
	import { addToast } from '$lib/stores/toast.svelte';
	import { onMount } from 'svelte';

	let { data } = $props();

	interface Channel { id: string; name: string; type: number; parentId: string | null }
	interface Role { id: string; name: string; color: number; position: number; mentionable: boolean }

	let template = $state(data.template ?? '');
	let channels = $state<Channel[]>([]);
	let roles = $state<Role[]>([]);
	let loading = $state(true);
	let saving = $state(false);

	onMount(async () => {
		try {
			const res = await fetch('/api/welcome/mentionables');
			const result = await res.json();
			if (result.success) {
				channels = result.data.channels;
				roles = result.data.roles;
			} else {
				addToast('Failed to load channels and roles', 'error');
			}
		} catch {
			addToast('Failed to load channels and roles', 'error');
		} finally {
			loading = false;
		}
	});

	async function save() {
		if (saving) return;
		saving = true;
		try {
			const value = template.trim().length === 0 ? null : template;
			const res = await fetch('/api/config/update', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fields: { welcome_template: value } })
			});
			const result = await res.json();
			if (!result.success) {
				addToast(result.error || 'Failed to save', 'error');
				return;
			}
			addToast('Welcome message saved', 'success', 2000);
		} catch (err) {
			addToast(err instanceof Error ? err.message : 'Save failed', 'error');
		} finally {
			saving = false;
		}
	}

	function reset() {
		template = data.template ?? '';
	}

	let isDirty = $derived(template !== (data.template ?? ''));
</script>

<SpringReveal stagger={30}>
	<PageHeader
		title="Welcome message"
		subtitle="Set the message new members see when they're approved. Type # to pick a channel, @ to ping a role."
	/>

	{#if loading}
		<div class="loading">Loading channels and roles…</div>
	{:else}
		<WelcomeMessageEditor bind:value={template} {channels} {roles} />

		<div class="actions">
			<button class="btn btn-secondary" onclick={reset} disabled={!isDirty || saving}>
				Reset
			</button>
			<button class="btn btn-primary" onclick={save} disabled={!isDirty || saving}>
				{saving ? 'Saving…' : 'Save'}
			</button>
		</div>

	{/if}
</SpringReveal>

<style>
	.loading {
		color: var(--text-secondary);
		font-size: 0.85rem;
		padding: 2rem;
		text-align: center;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	.btn {
		padding: 0.5rem 1rem;
		font-size: 0.85rem;
		font-weight: 500;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-holdfast);
		cursor: pointer;
		transition: all 120ms var(--ease-smooth);
	}

	.btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.btn-secondary {
		background: var(--surface);
		color: var(--text-secondary);
	}

	.btn-secondary:not(:disabled):hover {
		background: var(--surface-raised);
		color: var(--text-primary);
	}

	.btn-primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--bg);
	}

	.btn-primary:not(:disabled):hover {
		filter: brightness(1.1);
	}

</style>
