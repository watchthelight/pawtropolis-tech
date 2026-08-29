<script lang="ts">
	type Props = { since: string };
	let { since }: Props = $props();

	let label = $derived(
		new Date(`${since}T00:00:00Z`).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		})
	);
</script>

<span class="new-badge" title={`Added ${label}`}>
	<span class="spark" aria-hidden="true"></span>
	<span class="label">New</span>
</span>

<style>
	.new-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.4em;
		padding: 0.2em 0.6em;
		border-radius: var(--radius-sm);
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		line-height: 1.2;
		white-space: nowrap;
		color: oklch(96% 0.05 85);
		border: 1px solid oklch(58% 0.13 85);
		background: oklch(28% 0.08 85);
	}
	.spark {
		width: 0.45em;
		height: 0.45em;
		border-radius: 50%;
		background: oklch(78% 0.16 85);
		box-shadow: 0 0 0 0 oklch(78% 0.16 85 / 0.7);
		animation: pulse 2.4s ease-out infinite;
	}
	@keyframes pulse {
		0% {
			box-shadow: 0 0 0 0 oklch(78% 0.16 85 / 0.65);
		}
		70% {
			box-shadow: 0 0 0 0.5em oklch(78% 0.16 85 / 0);
		}
		100% {
			box-shadow: 0 0 0 0 oklch(78% 0.16 85 / 0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spark {
			animation: none;
		}
	}
</style>
