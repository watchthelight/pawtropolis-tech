<script lang="ts">
	import { onMount } from 'svelte';

	let mounted = $state(false);

	onMount(() => {
		// Stagger the entrance animation
		mounted = true;
	});
</script>

<div class="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
	<div
		class="text-center transition-all duration-700 ease-[var(--ease-spring)]"
		class:opacity-0={!mounted}
		class:translate-y-4={!mounted}
		class:opacity-100={mounted}
		class:translate-y-0={mounted}
	>
		<!-- Logo / Title -->
		<h1 class="text-4xl font-bold text-[var(--text-primary)] mb-2 tracking-tight">
			Pawtropolis
		</h1>
		<p class="text-[var(--text-secondary)] mb-10 text-lg">
			Moderator Dashboard
		</p>

		<!-- Sign in button -->
		<a
			href="/auth/login"
			class="inline-flex items-center gap-3 px-8 py-3.5 rounded-lg
				bg-[#5865f2] hover:bg-[#4752c4] active:bg-[#3c45a5]
				text-white font-medium text-base
				transition-all duration-[var(--duration-normal)] ease-[var(--ease-smooth)]
				hover:scale-[1.02] active:scale-[0.98]
				shadow-lg shadow-[#5865f2]/20 hover:shadow-xl hover:shadow-[#5865f2]/30"
		>
			<!-- Discord logo SVG -->
			<svg width="20" height="15" viewBox="0 0 71 55" fill="currentColor">
				<path d="M60.1045 4.8978C55.5792 2.8214 50.7265 1.2916 45.6527 0.41542C45.5603 0.39851 45.468 0.440769 45.4204 0.525289C44.7963 1.6353 44.105 3.0834 43.6209 4.2216C38.1637 3.4046 32.7345 3.4046 27.3892 4.2216C26.905 3.0581 26.1886 1.6353 25.5617 0.525289C25.5141 0.443589 25.4218 0.40133 25.3294 0.41542C20.2584 1.2888 15.4057 2.8186 10.8776 4.8978C10.8384 4.9147 10.8048 4.9429 10.7825 4.9795C1.57795 18.7309 -0.943561 32.1443 0.293408 45.3914C0.299005 45.4562 0.335386 45.5182 0.385761 45.5576C6.45866 50.0174 12.3413 52.7249 18.1147 54.5195C18.2071 54.5477 18.305 54.5139 18.3638 54.4378C19.7295 52.5728 20.9469 50.6063 21.9907 48.5383C22.0523 48.4172 21.9935 48.2735 21.8676 48.2256C19.9366 47.4931 18.0979 46.6 16.3292 45.5858C16.1893 45.5041 16.1781 45.304 16.3068 45.2082C16.679 44.9293 17.0513 44.6391 17.4067 44.3461C17.471 44.2926 17.5606 44.2813 17.6362 44.3151C29.2558 49.6202 41.8354 49.6202 53.3179 44.3151C53.3## 44.2785 53.4eli 44.2898 53.4789 44.3433C53.8343 44.6363 54.2066 44.9293 54.5816 45.2082C54.7103 45.304 54.7019 45.5041 54.562 45.5858C52.7933 46.6197 50.9546 47.4931 49.0236 48.2228C48.8978 48.2707 48.8418 48.4172 48.9005 48.5383C49.9671 50.6034 51.1845 52.5699 52.5765 54.435C52.6325 54.5139 52.7332 54.5477 52.8256 54.5195C58.6247 52.7249 64.5073 50.0174 70.5802 45.5576C70.6334 45.5182 70.667 45.459 70.6726 45.3942C72.1543 30.0791 68.2048 16.7757 60.1933 4.9823C60.1737 4.9429 60.1401 4.9147 60.1045 4.8978Z"/>
			</svg>
			Sign in with Discord
		</a>

		<p class="mt-8 text-xs text-[var(--text-muted)]">
			Staff access only
		</p>
	</div>
</div>
