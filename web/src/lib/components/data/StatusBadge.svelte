<script lang="ts">
	let { status, size = 'md' }: {
		status: string;
		size?: 'sm' | 'md';
	} = $props();

	const colorMap: Record<string, { text: string; bg: string }> = {
		pending:  { text: 'var(--info)',    bg: 'oklch(65% 0.12 250 / 0.15)' },
		claimed:  { text: 'var(--warn)', bg: 'oklch(70% 0.15 85 / 0.15)' },
		approved: { text: 'var(--good)', bg: 'oklch(65% 0.15 145 / 0.15)' },
		rejected: { text: 'var(--danger)',  bg: 'oklch(60% 0.15 25 / 0.15)' },
		kicked:   { text: 'var(--danger)',  bg: 'oklch(60% 0.15 25 / 0.15)' }
	};

	const fallback = { text: 'var(--ink-2)', bg: 'var(--surface-2)' };

	let colors = $derived(colorMap[status] ?? fallback);
</script>

<span
	class="inline-flex items-center rounded-full font-medium capitalize"
	class:px-2={size === 'sm'}
	class:py-0.5={size === 'sm'}
	class:text-xs={size === 'sm'}
	class:px-3={size === 'md'}
	class:py-1={size === 'md'}
	class:text-sm={size === 'md'}
	style:color={colors.text}
	style:background-color={colors.bg}
>
	{status}
</span>
