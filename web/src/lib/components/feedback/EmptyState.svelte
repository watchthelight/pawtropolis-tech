<script lang="ts">
	let { message, icon, subtitle }: {
		message: string;
		icon?: string;
		subtitle?: string;
	} = $props();
</script>

<div class="flex flex-col items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
	{#if icon}
		<span class="mb-3 text-3xl">{icon}</span>
	{/if}
	<p class="text-base font-medium text-[var(--text-primary)]">{message}</p>
	{#if subtitle}
		<p class="mt-1 text-sm text-[var(--text-secondary)]">{subtitle}</p>
	{/if}
</div>
