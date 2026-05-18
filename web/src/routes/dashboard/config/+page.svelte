<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import EditableFieldRow from '$lib/components/config/EditableFieldRow.svelte';
	import { CONFIG_FIELD_RULES, hasMinTier } from '$lib/shared/configValidation';
	import { addToast } from '$lib/stores/toast.svelte';
	import { subscribe, unsubscribe } from '$lib/stores/sse.svelte';
	import { invalidateAll } from '$app/navigation';
	import { slide } from 'svelte/transition';
	import type { SSEEvent } from '$lib/types/events';

	let { data } = $props();
	let sections = $derived(data.sections);
	let userTier = $derived(data.userTier);

	// Track which sections are collapsed
	let collapsed = $state<Record<string, boolean>>({});
	function toggle(title: string) {
		collapsed[title] = !collapsed[title];
	}

	// Check if user can edit a specific field
	function canEditField(key: string): boolean {
		const rule = CONFIG_FIELD_RULES[key];
		if (!rule) return false;
		return hasMinTier(userTier, rule.minTier);
	}

	// Check if user can edit ANY field in a section
	function canEditSection(sectionTitle: string): boolean {
		const section = sections.find((s) => s.title === sectionTitle);
		if (!section) return false;
		return section.fields.some((f) => canEditField(f.key));
	}

	// Save a single field
	async function saveField(key: string, value: unknown): Promise<void> {
		const res = await fetch('/api/config/update', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ fields: { [key]: value } })
		});

		const result = await res.json();

		if (!result.success) {
			addToast(result.error || 'Failed to save', 'error');
			throw new Error(result.error || 'Save failed');
		}

		addToast(`${CONFIG_FIELD_RULES[key]?.label ?? key} updated`, 'success', 2000);
		// Refresh data from server to get the normalized value back
		invalidateAll();
	}

	// SSE listener for config changes by other users
	let invalidateTimer: ReturnType<typeof setTimeout> | undefined;
	function onConfigUpdated(_event: SSEEvent) {
		if (invalidateTimer) clearTimeout(invalidateTimer);
		invalidateTimer = setTimeout(() => invalidateAll(), 200);
	}

	$effect(() => {
		subscribe('config:updated', onConfigUpdated);
		return () => {
			unsubscribe('config:updated', onConfigUpdated);
			if (invalidateTimer) clearTimeout(invalidateTimer);
		};
	});
</script>

<SpringReveal stagger={30}>
	<PageHeader title="Config" subtitle="Bot and guild settings" />

	<a class="editor-link" href="/dashboard/config/welcome">
		<span class="editor-link-icon" aria-hidden="true">
			<svg width="14" height="14" viewBox="0 0 16 16" fill="none">
				<path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		</span>
		<span class="editor-link-body">
			<span class="editor-link-title">Welcome message editor</span>
			<span class="editor-link-sub">Visual editor with channel and role autocomplete, live Discord preview</span>
		</span>
		<span class="editor-link-arrow" aria-hidden="true">→</span>
	</a>

	{#if sections.length === 0}
		<EmptyState
			message="No configuration found"
			subtitle="Guild configuration has not been set up yet."
		/>
	{:else}
		<div class="sections">
			{#each sections as section (section.title)}
				<div class="section">
					<button class="section-header" onclick={() => toggle(section.title)}>
						<span class="section-title">{section.title}</span>
						<span class="section-count">{section.fields.length}</span>
						{#if !canEditSection(section.title)}
							<span class="section-lock" title="Read-only for your role">
								<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
									<path d="M8 1a4 4 0 0 0-4 4v2H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-1V5a4 4 0 0 0-4-4zm-2 4a2 2 0 1 1 4 0v2H6V5z"/>
								</svg>
							</span>
						{/if}
						<span class="chevron" class:chevron-collapsed={collapsed[section.title]}>
							<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
								<path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
							</svg>
						</span>
					</button>

					{#if !collapsed[section.title]}
						<div class="section-body" transition:slide={{ duration: 150 }}>
							{#each section.fields as field (field.key)}
								<EditableFieldRow
									fieldKey={field.key}
									label={field.label}
									value={field.value}
									type={field.type}
									rule={CONFIG_FIELD_RULES[field.key]}
									canEdit={canEditField(field.key)}
									onSave={saveField}
								/>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</SpringReveal>

<style>
	.sections {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.section {
		background: var(--surface);
		border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.section-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.75rem 1rem;
		border: none;
		background: none;
		color: var(--text-primary);
		cursor: pointer;
		text-align: left;
		transition: background 150ms var(--ease-smooth);
	}

	@media (hover: hover) {
		.section-header:hover {
			background: var(--surface-raised);
		}
	}

	.section-title {
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.04em;
	}

	.section-count {
		font-size: 0.65rem;
		font-weight: 600;
		padding: 0.1rem 0.35rem;
		border-radius: var(--radius-sm);
		background: var(--accent-dim);
		color: var(--accent);
		font-variant-numeric: tabular-nums;
	}

	.section-lock {
		color: var(--text-secondary);
		opacity: 0.4;
		display: flex;
	}

	.chevron {
		margin-left: auto;
		color: var(--text-secondary);
		transition: transform 150ms var(--ease-smooth);
		display: flex;
	}

	.chevron-collapsed {
		transform: rotate(-90deg);
	}

	.section-body {
		border-top: 1px solid var(--border);
	}

	.editor-link {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		margin-bottom: 0.75rem;
		background: var(--surface);
		border: 1px solid var(--border-holdfast);
		border-radius: var(--radius-md);
		color: var(--text-primary);
		text-decoration: none;
		transition: background 150ms var(--ease-smooth), border-color 150ms var(--ease-smooth);
	}

	@media (hover: hover) {
		.editor-link:hover {
			background: var(--surface-raised);
			border-color: var(--accent);
		}
	}

	.editor-link-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: var(--radius-sm);
		background: var(--accent-dim);
		color: var(--accent);
		flex-shrink: 0;
	}

	.editor-link-body {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		flex: 1;
		min-width: 0;
	}

	.editor-link-title {
		font-size: 0.85rem;
		font-weight: 600;
	}

	.editor-link-sub {
		font-size: 0.7rem;
		color: var(--text-secondary);
	}

	.editor-link-arrow {
		color: var(--text-secondary);
		font-size: 1rem;
	}
</style>
