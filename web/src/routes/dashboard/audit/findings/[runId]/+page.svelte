<script lang="ts">
	import DataCard from '$lib/components/data/DataCard.svelte';
	import StatNumber from '$lib/components/data/StatNumber.svelte';
	import SpringReveal from '$lib/components/motion/SpringReveal.svelte';

	let { data } = $props();
	let stats = $derived(data.stats);
	let findings = $derived(data.findings);

	let severityFilter = $state<string | null>(null);
	let expandedId = $state<number | null>(null);

	let filtered = $derived(
		severityFilter
			? findings.filter(f => f.issueSeverity === severityFilter)
			: findings
	);

	function passRate(): number {
		const testable = stats.commandCount - stats.skipCount;
		return testable > 0 ? Math.round((stats.passCount / testable) * 100) : 0;
	}

	function statusBadgeColor(status: string): string {
		switch (status) {
			case 'pass': return 'var(--good)';
			case 'fail': return 'var(--danger)';
			case 'error': return 'oklch(65% 0.15 40)';
			default: return 'var(--ink-faint)';
		}
	}

	function severityColor(severity: string | null): string {
		switch (severity) {
			case 'critical': return 'var(--danger)';
			case 'high': return 'oklch(65% 0.15 40)';
			case 'medium': return 'var(--warn)';
			case 'low': return 'var(--info)';
			case 'info': return 'var(--ink-faint)';
			default: return 'transparent';
		}
	}

	function exportMarkdown() {
		const lines = [`# Audit Run: ${data.runId}`, '', `Pass rate: ${passRate()}%`, `Commands: ${stats.commandCount}`, ''];
		for (const f of findings) {
			lines.push(`## ${f.commandName}${f.subcommand ? ` ${f.subcommand}` : ''}`);
			lines.push(`Status: ${f.testStatus}${f.issueSeverity ? ` | Severity: ${f.issueSeverity}` : ''}`);
			if (f.issueTitle) lines.push(`Issue: ${f.issueTitle}`);
			if (f.issueDescription) lines.push(f.issueDescription);
			if (f.notes) lines.push(`Notes: ${f.notes}`);
			lines.push('');
		}
		const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `audit-${data.runId.slice(0, 8)}.md`;
		a.click();
		URL.revokeObjectURL(url);
	}

	const SEVERITY_PILLS = ['critical', 'high', 'medium', 'low', 'info'] as const;
</script>

<SpringReveal stagger={30}>
	<a href="/dashboard/audit/findings" class="back-link">&larr; Back to Findings</a>

	<!-- Summary -->
	<div class="summary-grid">
		<DataCard>
			<div class="rate-display" style:color={passRate() >= 95 ? 'var(--good)' : passRate() >= 80 ? 'var(--warn)' : 'var(--danger)'}>{passRate()}%</div>
			<span class="rate-label">Pass Rate</span>
		</DataCard>
		<DataCard>
			<StatNumber value={stats.commandCount} label="Commands" />
		</DataCard>
		<DataCard accent={stats.criticalCount > 0}>
			<StatNumber value={stats.criticalCount} label="Critical" />
		</DataCard>
		<DataCard>
			<StatNumber value={stats.highCount} label="High" />
		</DataCard>
		<DataCard>
			<StatNumber value={stats.totalApiCalls} label="API Calls" />
		</DataCard>
		<DataCard>
			<div class="cost-display">${stats.totalApiCost.toFixed(2)}</div>
			<span class="rate-label">API Cost</span>
		</DataCard>
	</div>

	<!-- Severity filter pills -->
	<div class="filter-row">
		<button class="pill" class:pill-active={!severityFilter} onclick={() => severityFilter = null}>All ({findings.length})</button>
		{#each SEVERITY_PILLS as sev}
			{@const count = findings.filter(f => f.issueSeverity === sev).length}
			{#if count > 0}
				<button class="pill" class:pill-active={severityFilter === sev} onclick={() => severityFilter = severityFilter === sev ? null : sev}>
					<span class="pill-dot" style:background={severityColor(sev)}></span>
					{sev} ({count})
				</button>
			{/if}
		{/each}
		<button class="export-btn" onclick={exportMarkdown}>Export MD</button>
	</div>

	<!-- Findings list -->
	<div class="findings-list">
		{#each filtered as finding (finding.id)}
			<button
				class="finding-row"
				onclick={() => expandedId = expandedId === finding.id ? null : finding.id}
			>
				<span class="status-badge" style:background={statusBadgeColor(finding.testStatus)}>
					{finding.testStatus.toUpperCase()}
				</span>
				{#if finding.issueSeverity}
					<span class="severity-badge" style:background={severityColor(finding.issueSeverity)}>
						{finding.issueSeverity.toUpperCase()}
					</span>
				{/if}
				<span class="finding-cmd">
					/{finding.commandName}{finding.subcommand ? ` ${finding.subcommand}` : ''}
				</span>
				{#if finding.issueTitle}
					<span class="finding-title">{finding.issueTitle}</span>
				{/if}
				{#if finding.responseTimeMs != null}
					<span class="finding-time">{finding.responseTimeMs}ms</span>
				{/if}
			</button>
			{#if expandedId === finding.id}
				<div class="finding-detail">
					{#if finding.issueDescription}
						<div class="detail-block">
							<span class="detail-label">Description</span>
							<p class="detail-text">{finding.issueDescription}</p>
						</div>
					{/if}
					{#if finding.docIssue}
						<div class="detail-block">
							<span class="detail-label">Doc Issue</span>
							<p class="detail-text">{finding.docIssue}{finding.docFile ? ` (${finding.docFile})` : ''}</p>
						</div>
					{/if}
					{#if finding.expectedPermission && finding.actualPermission}
						<div class="detail-block">
							<span class="detail-label">Permission Mismatch</span>
							<p class="detail-text">Expected: {finding.expectedPermission} | Actual: {finding.actualPermission}</p>
						</div>
					{/if}
					{#if finding.notes}
						<div class="detail-block">
							<span class="detail-label">Notes</span>
							<p class="detail-text">{finding.notes}</p>
						</div>
					{/if}
					<div class="detail-meta">
						Type: {finding.testType} | API calls: {finding.apiCallsMade} | Cost: ${finding.apiCostEstimate.toFixed(4)}
					</div>
				</div>
			{/if}
		{/each}
	</div>
</SpringReveal>

<style>
	.back-link {
		font-size: 0.8rem;
		color: var(--sage);
		text-decoration: none;
		display: inline-block;
		margin-bottom: 1rem;
	}

	.summary-grid {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.rate-display {
		font-size: 2.5rem;
		font-weight: 700;
		line-height: 1.1;
	}

	.cost-display {
		font-size: 2rem;
		font-weight: 700;
		line-height: 1.1;
		color: var(--ink);
	}

	.rate-label {
		font-size: 0.8rem;
		color: var(--sage-muted);
		margin-top: 0.15rem;
	}

	.filter-row {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
		align-items: center;
	}

	.pill {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.3rem 0.6rem;
		font-size: 0.7rem;
		font-weight: 500;
		background: var(--surface);
		border: 1px solid var(--line-soft);
		border-radius: var(--radius-pill);
		color: var(--ink-2);
		cursor: pointer;
		transition: all var(--duration-fast);
	}

	.pill-active {
		background: var(--sage-fill);
		border-color: var(--sage);
		color: var(--sage);
	}

	.pill-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}

	.export-btn {
		margin-left: auto;
		padding: 0.3rem 0.75rem;
		font-size: 0.7rem;
		font-weight: 500;
		background: var(--surface-2);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		color: var(--ink);
		cursor: pointer;
		transition: all var(--duration-fast);
	}

	.export-btn:hover {
		background: var(--sage);
		color: var(--void);
		border-color: var(--sage);
	}

	.findings-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.finding-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: var(--surface);
		border: 1px solid var(--line-soft);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background var(--duration-fast);
		width: 100%;
		text-align: left;
		font: inherit;
		color: inherit;
	}

	.finding-row:hover {
		background: var(--surface-2);
	}

	.status-badge, .severity-badge {
		font-size: 0.5rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		padding: 0.1rem 0.3rem;
		border-radius: 3px;
		color: var(--void);
		flex-shrink: 0;
	}

	.finding-cmd {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--ink);
		font-family: var(--terminal-font);
	}

	.finding-title {
		font-size: 0.75rem;
		color: var(--ink-2);
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.finding-time {
		font-size: 0.65rem;
		color: var(--ink-faint);
		flex-shrink: 0;
	}

	.finding-detail {
		padding: 0.75rem 0.75rem 0.75rem 2rem;
		background: var(--surface);
		border: 1px solid var(--line-soft);
		border-top: none;
		border-radius: 0 0 var(--radius-sm) var(--radius-sm);
		margin-top: -2px;
	}

	.detail-block {
		margin-bottom: 0.75rem;
	}

	.detail-label {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-faint);
	}

	.detail-text {
		font-size: 0.8rem;
		color: var(--ink-2);
		line-height: 1.5;
		margin: 0.15rem 0 0;
		white-space: pre-wrap;
	}

	.detail-meta {
		font-size: 0.65rem;
		color: var(--ink-faint);
		border-top: 1px solid var(--line-soft);
		padding-top: 0.5rem;
		margin-top: 0.5rem;
	}

	@media (max-width: 768px) {
		.summary-grid {
			grid-template-columns: repeat(3, 1fr);
		}

		.finding-title {
			display: none;
		}
	}

	@media (max-width: 480px) {
		.summary-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
