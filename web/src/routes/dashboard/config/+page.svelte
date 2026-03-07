<script lang="ts">
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import EmptyState from '$lib/components/feedback/EmptyState.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';
	import CopyableId from '$lib/components/data/CopyableId.svelte';
	import { slide } from 'svelte/transition';
	import type { ConfigField } from '$lib/server/queries/config';

	let { data } = $props();
	let sections = $derived(data.sections);

	// Track which sections are collapsed
	let collapsed = $state<Record<string, boolean>>({});
	function toggle(title: string) {
		collapsed[title] = !collapsed[title];
	}

	function formatValue(field: ConfigField): string {
		const { value, type } = field;
		if (value == null || value === '') return '\u2014';

		switch (type) {
			case 'bool':
				return value === 1 || value === true ? 'Enabled' : 'Disabled';
			case 'ms': {
				const ms = Number(value);
				if (ms >= 60000) return `${(ms / 60000).toFixed(1)}min`;
				if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
				return `${ms}ms`;
			}
			case 'seconds':
				return `${value}s`;
			case 'minutes':
				return `${value}min`;
			case 'hours':
				return `${value}h`;
			case 'chars':
				return `${value} chars`;
			case 'percent': {
				const n = Number(value);
				return n <= 1 ? `${(n * 100).toFixed(0)}%` : `${n}%`;
			}
			case 'json': {
				try {
					const parsed = JSON.parse(String(value));
					if (Array.isArray(parsed)) return parsed.length === 0 ? 'None' : parsed.join(', ');
					return JSON.stringify(parsed, null, 2);
				} catch {
					return String(value);
				}
			}
			case 'template':
				return String(value).length > 80
					? String(value).slice(0, 80) + '\u2026'
					: String(value);
			default:
				return String(value);
		}
	}

	function isSnowflake(value: unknown): boolean {
		return typeof value === 'string' && /^\d{17,20}$/.test(value);
	}

	function isBoolField(field: ConfigField): boolean {
		return field.type === 'bool';
	}

	function boolEnabled(field: ConfigField): boolean {
		return field.value === 1 || field.value === true;
	}
</script>

<SpringReveal stagger={30}>
	<PageHeader title="Config" subtitle="Bot and guild settings" />

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
						<span class="chevron" class:chevron-collapsed={collapsed[section.title]}>
							<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
								<path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
							</svg>
						</span>
					</button>

					{#if !collapsed[section.title]}
						<div class="section-body" transition:slide={{ duration: 150 }}>
							{#each section.fields as field (field.key)}
								<div class="field-row">
									<span class="field-label">{field.label}</span>
									<span class="field-value">
										{#if isBoolField(field)}
											<span class="bool-indicator" class:bool-on={boolEnabled(field)} class:bool-off={!boolEnabled(field)}>
												{boolEnabled(field) ? 'Enabled' : 'Disabled'}
											</span>
										{:else if (field.type === 'channel' || field.type === 'role') && isSnowflake(field.value)}
											<CopyableId value={String(field.value)} />
										{:else if field.type === 'roles' && field.value}
											{#each String(field.value).split(',').map(s => s.trim()).filter(Boolean) as roleId, i}
												{#if i > 0}<span class="separator">,</span>{/if}
												<CopyableId value={roleId} />
											{/each}
										{:else}
											<span class="value-text" class:value-null={field.value == null || field.value === ''}>
												{formatValue(field)}
											</span>
										{/if}
									</span>
								</div>
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

	.field-row {
		display: flex;
		align-items: baseline;
		gap: 1rem;
		padding: 0.5rem 1rem;
		border-bottom: 1px solid var(--border);
		font-size: 0.8rem;
	}

	.field-row:last-child {
		border-bottom: none;
	}

	@media (hover: hover) {
		.field-row:hover {
			background: var(--surface-raised);
		}
	}

	.field-label {
		width: 12rem;
		flex-shrink: 0;
		color: var(--text-secondary);
		font-size: 0.75rem;
		font-weight: 500;
	}

	.field-value {
		flex: 1;
		min-width: 0;
		color: var(--text-primary);
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-wrap: wrap;
		word-break: break-all;
	}

	.value-text {
		font-variant-numeric: tabular-nums;
	}

	.value-null {
		color: var(--text-secondary);
		opacity: 0.5;
	}

	.separator {
		color: var(--text-secondary);
		margin: 0 0.125rem;
	}

	/* ─── Bool indicator ─── */
	.bool-indicator {
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.1rem 0.375rem;
		border-radius: var(--radius-sm);
	}

	.bool-on {
		background: oklch(25% 0.06 145);
		color: var(--status-success);
	}

	.bool-off {
		background: oklch(25% 0.04 0);
		color: var(--text-secondary);
	}

	/* ─── Mobile ─── */
	@media (max-width: 768px) {
		.field-row {
			flex-direction: column;
			gap: 0.25rem;
		}

		.field-label {
			width: auto;
		}
	}
</style>
