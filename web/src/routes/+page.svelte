<script lang="ts">
	import { onMount } from 'svelte';
	import { prefersReducedMotion } from '$lib/motion';

	let blobsRef: HTMLDivElement;
	let btnRef: HTMLAnchorElement;

	function handleBtnMouse(e: MouseEvent) {
		if (!btnRef || prefersReducedMotion() || window.matchMedia('(pointer: coarse)').matches) return;
		const rect = btnRef.getBoundingClientRect();
		const x = (e.clientX - rect.left) / rect.width - 0.5;
		const y = (e.clientY - rect.top) / rect.height - 0.5;
		btnRef.style.transform = `perspective(400px) rotateX(${y * -8}deg) rotateY(${x * 8}deg) scale(1.02)`;
	}

	function handleBtnLeave() {
		if (!btnRef) return;
		btnRef.style.transform = 'perspective(400px) rotateX(0) rotateY(0) scale(1)';
	}

	function handleBtnDown() {
		if (!btnRef) return;
		btnRef.style.transform = 'perspective(400px) rotateX(0) rotateY(0) scale(0.98)';
		btnRef.style.boxShadow = 'inset 6px 6px 16px oklch(5% 0.005 40), inset -6px -6px 16px oklch(22% 0.015 40)';
	}

	function handleBtnUp() {
		if (!btnRef) return;
		btnRef.style.boxShadow = '';
	}

	onMount(() => {
		// Skip mouse tracking on touch devices
		if (window.matchMedia('(pointer: coarse)').matches) return;
		const handleMouse = (e: MouseEvent) => {
			if (!blobsRef || prefersReducedMotion()) return;
			const x = (e.clientX / window.innerWidth - 0.5) * 6;
			const y = (e.clientY / window.innerHeight - 0.5) * 6;
			blobsRef.style.transform = `translate(${x}px, ${y}px)`;
		};
		window.addEventListener('mousemove', handleMouse);
		return () => window.removeEventListener('mousemove', handleMouse);
	});
</script>

<div class="splash">
	<!-- Atmospheric gradient blobs — more colorful -->
	<div bind:this={blobsRef} class="blobs" aria-hidden="true">
		<div class="blob blob-magenta"></div>
		<div class="blob blob-cyan"></div>
		<div class="blob blob-violet"></div>
		<div class="blob blob-warm"></div>
		<div class="blob blob-rose"></div>
		<div class="blob blob-teal"></div>
		<div class="blob blob-peach"></div>
	</div>

	<!-- Vignette -->
	<div class="vignette" aria-hidden="true"></div>

	<!-- Scattered sparkles — strawpage indie touch -->
	<div class="sparkles" aria-hidden="true">
		<span class="sparkle s1">+</span>
		<span class="sparkle s2">.</span>
		<span class="sparkle s3">+</span>
		<span class="sparkle s4">*</span>
		<span class="sparkle s5">.</span>
		<span class="sparkle s6">+</span>
		<span class="sparkle s7">*</span>
		<span class="sparkle s8">.</span>
	</div>

	<!-- City skyline silhouette -->
	<div class="skyline" aria-hidden="true">
		<svg viewBox="0 0 1440 200" preserveAspectRatio="none" style="fill: oklch(18% 0.015 var(--hue))">
			<path d="M0 200V160h40v-20h20v20h30V120h15v-30h10v30h15v40h25V100h10V80h10v20h10v40h20V90h8V60h8v30h8v50h30v-30h20v-20h15v20h20v30h40V80h10V50h10v30h10v60h25V100h15V70h10v30h15v40h35v-50h20v-15h10v15h20v50h30V110h10V80h10v30h10v30h50v-40h15V90h10v20h15v40h20V100h20V75h10v25h20v50h30v-30h10V90h10v30h10v30h25V80h15V50h10v30h15v40h30V120h20V90h10v30h20v50h40V130h10V100h10v30h10v40h30v-50h10V90h10v30h10v50h20v-20h30v-30h10v30h30v20h40V140h10V110h10v30h10v60z"/>
		</svg>
	</div>

	<!-- Content — centered, stacked, strawpage-style -->
	<div class="content">
		<img src="/paw-logo.png" alt="Pawtropolis" class="logo" />

		<h1 class="title">Pawtropolis</h1>

		<!-- Decorative divider — indie touch -->
		<div class="divider" aria-hidden="true">
			<span class="divider-dot"></span>
			<span class="divider-line"></span>
			<span class="divider-star">&#10038;</span>
			<span class="divider-line"></span>
			<span class="divider-dot"></span>
		</div>

		<p class="subtitle">A Safe Place For Everyone</p>

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<a
			bind:this={btnRef}
			href="/auth/login"
			class="discord-btn shimmer"
			onmousemove={handleBtnMouse}
			onmouseleave={handleBtnLeave}
			onmousedown={handleBtnDown}
			onmouseup={handleBtnUp}
		>
			<svg width="20" height="15" viewBox="0 0 71 55" fill="currentColor" aria-hidden="true">
				<path d="M60.1045 4.8978C55.5792 2.8214 50.7265 1.2916 45.6527 0.41542C45.5603 0.39851 45.468 0.440769 45.4204 0.525289C44.7963 1.6353 44.105 3.0834 43.6209 4.2216C38.1637 3.4046 32.7345 3.4046 27.3892 4.2216C26.905 3.0581 26.1886 1.6353 25.5617 0.525289C25.5141 0.443589 25.4218 0.40133 25.3294 0.41542C20.2584 1.2888 15.4057 2.8186 10.8776 4.8978C10.8384 4.9147 10.8048 4.9429 10.7825 4.9795C1.57795 18.7309 -0.943561 32.1443 0.293408 45.3914C0.299005 45.4562 0.335386 45.5182 0.385761 45.5576C6.45866 50.0174 12.3413 52.7249 18.1147 54.5195C18.2071 54.5477 18.305 54.5139 18.3638 54.4378C19.7295 52.5728 20.9469 50.6063 21.9907 48.5383C22.0523 48.4172 21.9935 48.2735 21.8676 48.2256C19.9366 47.4931 18.0979 46.6 16.3292 45.5858C16.1893 45.5041 16.1781 45.304 16.3068 45.2082C16.679 44.9293 17.0513 44.6391 17.4067 44.3461C17.471 44.2926 17.5606 44.2813 17.6362 44.3151C29.2558 49.6202 41.8354 49.6202 53.3179 44.3151C53.3935 44.2785 53.483 44.2898 53.5502 44.3433C53.9056 44.6363 54.2778 44.9293 54.6528 45.2082C54.7816 45.304 54.7732 45.5041 54.6333 45.5858C52.8646 46.6197 51.0259 47.4931 49.0949 48.2228C48.969 48.2707 48.913 48.4172 48.9718 48.5383C50.0384 50.6034 51.2558 52.5699 52.6477 54.435C52.7038 54.5139 52.8044 54.5477 52.8968 54.5195C58.696 52.7249 64.5786 50.0174 70.6514 45.5576C70.7047 45.5182 70.7383 45.459 70.7439 45.3942C72.2256 30.0791 68.2761 16.7757 60.2646 4.9823C60.245 4.9429 60.2114 4.9147 60.1045 4.8978Z"/>
			</svg>
			Sign in with Discord
		</a>

		<p class="footer">staff access only</p>
	</div>
</div>

<style>
	.splash {
		position: relative;
		min-height: var(--vh-full);
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		background-color: var(--bg);
	}

	/* Atmospheric blobs — more colors per Entropy */
	.blobs {
		position: absolute;
		inset: 0;
		transition: transform 0.15s ease-out;
		pointer-events: none;
	}

	.blob {
		position: absolute;
		border-radius: 50%;
		filter: blur(90px);
	}

	.blob-magenta {
		width: 450px;
		height: 450px;
		top: -5%;
		left: 8%;
		background: oklch(60% 0.25 330);
		opacity: 0.09;
		animation: drift-1 25s ease-in-out infinite alternate;
	}

	.blob-cyan {
		width: 380px;
		height: 380px;
		bottom: 10%;
		right: 8%;
		background: oklch(65% 0.18 200);
		opacity: 0.07;
		animation: drift-2 20s ease-in-out infinite alternate;
	}

	.blob-violet {
		width: 300px;
		height: 300px;
		top: 30%;
		right: 25%;
		background: oklch(55% 0.2 280);
		opacity: 0.06;
		animation: drift-3 30s ease-in-out infinite alternate;
	}

	.blob-warm {
		width: 250px;
		height: 250px;
		bottom: 25%;
		left: 20%;
		background: oklch(65% 0.18 50);
		opacity: 0.05;
		animation: drift-4 22s ease-in-out infinite alternate;
	}

	.blob-rose {
		width: 320px;
		height: 320px;
		top: 60%;
		left: 45%;
		background: oklch(58% 0.22 0);
		opacity: 0.05;
		animation: drift-5 28s ease-in-out infinite alternate;
	}

	.blob-teal {
		width: 280px;
		height: 280px;
		top: 10%;
		right: 40%;
		background: oklch(60% 0.15 170);
		opacity: 0.06;
		animation: drift-6 24s ease-in-out infinite alternate;
	}

	.blob-peach {
		width: 220px;
		height: 220px;
		bottom: 5%;
		left: 55%;
		background: oklch(68% 0.16 70);
		opacity: 0.04;
		animation: drift-3 26s ease-in-out infinite alternate;
	}

	@keyframes drift-1 {
		0% { transform: translate(0, 0) scale(1); }
		100% { transform: translate(40px, 30px) scale(1.1); }
	}
	@keyframes drift-2 {
		0% { transform: translate(0, 0) scale(1); }
		100% { transform: translate(-30px, -20px) scale(0.9); }
	}
	@keyframes drift-3 {
		0% { transform: translate(0, 0); }
		100% { transform: translate(-20px, 25px); }
	}
	@keyframes drift-4 {
		0% { transform: translate(0, 0); }
		100% { transform: translate(25px, -15px); }
	}
	@keyframes drift-5 {
		0% { transform: translate(0, 0) scale(1); }
		100% { transform: translate(-35px, -25px) scale(1.05); }
	}
	@keyframes drift-6 {
		0% { transform: translate(0, 0); }
		100% { transform: translate(20px, 30px); }
	}

	/* Vignette */
	.vignette {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: radial-gradient(
			ellipse 65% 55% at 50% 45%,
			transparent 0%,
			oklch(10% 0.01 var(--hue) / 0.3) 60%,
			oklch(8% 0.01 var(--hue) / 0.7) 100%
		);
	}

	/* Scattered sparkles — strawpage aesthetic */
	.sparkles {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
	}

	.sparkle {
		position: absolute;
		color: oklch(70% 0.1 var(--hue));
		font-size: 0.75rem;
		opacity: 0;
		animation: twinkle 4s ease-in-out infinite;
	}

	.s1 { top: 15%; left: 20%; animation-delay: 0s; color: oklch(70% 0.15 330); }
	.s2 { top: 25%; right: 18%; animation-delay: 0.8s; color: oklch(70% 0.12 200); }
	.s3 { bottom: 30%; left: 12%; animation-delay: 1.5s; color: oklch(65% 0.15 280); }
	.s4 { top: 40%; left: 30%; animation-delay: 2.2s; color: oklch(70% 0.15 330); font-size: 0.5rem; }
	.s5 { bottom: 40%; right: 25%; animation-delay: 0.5s; color: oklch(70% 0.12 50); }
	.s6 { top: 12%; right: 30%; animation-delay: 1.8s; color: oklch(65% 0.15 200); }
	.s7 { bottom: 20%; left: 35%; animation-delay: 3s; color: oklch(70% 0.15 280); font-size: 0.6rem; }
	.s8 { top: 50%; right: 12%; animation-delay: 2.5s; color: oklch(65% 0.12 50); }

	@keyframes twinkle {
		0%, 100% { opacity: 0; transform: scale(0.8); }
		50% { opacity: 0.6; transform: scale(1); }
	}

	/* City skyline — full bleed edge to edge */
	.skyline {
		position: absolute;
		bottom: 0;
		left: -1px;
		right: -1px;
		height: 180px;
		opacity: 0.35;
		pointer-events: none;
	}

	.skyline svg {
		display: block;
		width: 100%;
		height: 100%;
	}

	/* Content — centered, stacked */
	.content {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 0;
		padding-bottom: 4rem;
	}

	.logo {
		width: 180px;
		height: 180px;
		margin-bottom: 1.5rem;
		filter: drop-shadow(0 4px 24px oklch(50% 0.2 330 / 0.35));
	}

	.title {
		font-size: 3rem;
		font-weight: 800;
		color: var(--text-primary);
		letter-spacing: -0.03em;
		line-height: 1;
		margin-bottom: 1rem;
	}

	/* Decorative divider — indie/strawpage touch */
	.divider {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.divider-line {
		width: 40px;
		height: 1px;
		background: linear-gradient(90deg, transparent, oklch(50% 0.1 330), transparent);
	}

	.divider-dot {
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: oklch(60% 0.15 200);
	}

	.divider-star {
		font-size: 0.7rem;
		color: oklch(65% 0.15 280);
	}

	.subtitle {
		font-size: 1rem;
		color: var(--text-secondary);
		letter-spacing: 0.04em;
		margin-bottom: 2.5rem;
	}

	/* Discord button — neumorphic + magnetic tilt */
	.discord-btn {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem 2.5rem;
		border-radius: var(--radius-lg);
		background: linear-gradient(135deg, var(--brand-magenta), var(--brand-cyan));
		color: white;
		font-weight: 600;
		font-size: 1rem;
		text-decoration: none;
		overflow: hidden;
		border: none;
		transition: transform 0.15s var(--ease-smooth), box-shadow 0.3s var(--ease-smooth);
		transform: perspective(400px) rotateX(0) rotateY(0) scale(1);
		transform-style: preserve-3d;
		box-shadow:
			10px 10px 24px oklch(6% 0.005 var(--hue)),
			-10px -10px 24px oklch(24% 0.015 var(--hue));
	}

	@media (hover: hover) {
		.discord-btn:hover {
			box-shadow:
				14px 14px 32px oklch(5% 0.005 var(--hue)),
				-14px -14px 32px oklch(26% 0.015 var(--hue));
		}
	}

	.discord-btn:active {
		transform: perspective(400px) scale(0.98);
	}

	/* Shimmer */
	.shimmer::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			105deg,
			transparent 40%,
			rgba(255, 255, 255, 0.1) 50%,
			transparent 60%
		);
		transform: translateX(-100%);
		animation: shimmer-sweep 1.5s ease-in-out 1.5s forwards;
		border-radius: inherit;
		pointer-events: none;
	}

	@keyframes shimmer-sweep {
		0% { transform: translateX(-100%); }
		100% { transform: translateX(100%); }
	}

	.footer {
		margin-top: 2rem;
		font-size: 0.7rem;
		color: var(--text-secondary);
		opacity: 0.5;
		letter-spacing: 0.1em;
		text-transform: lowercase;
	}

	/* Reduce motion */
	@media (prefers-reduced-motion: reduce) {
		.blob { animation: none; }
		.shimmer::after { animation: none; }
		.sparkle { animation: none; opacity: 0.3; }
	}

	@media (max-width: 640px) {
		.logo { width: 140px; height: 140px; }
		.title { font-size: 2.2rem; }
		.content { padding: 0 var(--mobile-pad) 4rem; }
		.blob-magenta { width: 250px; height: 250px; }
		.blob-cyan { width: 200px; height: 200px; }
		.blob-violet { width: 180px; height: 180px; }
		.blob-warm { width: 150px; height: 150px; }
		.blob-rose { width: 180px; height: 180px; }
		.blob-teal { width: 160px; height: 160px; }
		.blob-peach { width: 130px; height: 130px; }
		.skyline { height: 100px; }
		.discord-btn { padding: 0.875rem 2rem; font-size: 0.9rem; min-height: 44px; }
	}
</style>
