<script lang="ts">
	import { onMount } from 'svelte';
	import { prefersReducedMotion } from '$lib/motion';

	let blobsRef: HTMLDivElement;
	let btnRef: HTMLAnchorElement;

	function handleBtnMouse(e: MouseEvent) {
		if (!btnRef || prefersReducedMotion()) return;
		const rect = btnRef.getBoundingClientRect();
		const x = (e.clientX - rect.left) / rect.width - 0.5; // -0.5 to 0.5
		const y = (e.clientY - rect.top) / rect.height - 0.5;
		const tiltX = y * -8; // rotate opposite to mouse Y
		const tiltY = x * 8;  // rotate toward mouse X
		btnRef.style.transform = `perspective(400px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(1.02)`;
	}

	function handleBtnLeave() {
		if (!btnRef) return;
		btnRef.style.transform = 'perspective(400px) rotateX(0) rotateY(0) scale(1)';
	}

	function handleBtnDown() {
		if (!btnRef) return;
		btnRef.style.transform = 'perspective(400px) rotateX(0) rotateY(0) scale(0.97)';
		btnRef.style.boxShadow = 'inset 3px 3px 8px oklch(5% 0.01 40 / 0.5), inset -2px -2px 6px oklch(25% 0.02 40 / 0.15)';
	}

	function handleBtnUp() {
		if (!btnRef) return;
		btnRef.style.boxShadow = '';
	}

	onMount(() => {
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
	<!-- Atmospheric gradient blobs -->
	<div bind:this={blobsRef} class="blobs" aria-hidden="true">
		<div class="blob blob-magenta"></div>
		<div class="blob blob-cyan"></div>
	</div>

	<!-- Vignette overlay for threshold depth -->
	<div class="vignette" aria-hidden="true"></div>

	<!-- Paint drip trails from logo area -->
	<div class="drips" aria-hidden="true">
		<div class="drip drip-1"></div>
		<div class="drip drip-2"></div>
		<div class="drip drip-3"></div>
		<div class="drip drip-4"></div>
		<div class="drip drip-5"></div>
	</div>

	<!-- City skyline silhouette at bottom -->
	<div class="skyline" aria-hidden="true">
		<svg viewBox="0 0 1440 200" preserveAspectRatio="none" fill="oklch(18% 0.015 var(--hue))">
			<path d="M0 200V160h40v-20h20v20h30V120h15v-30h10v30h15v40h25V100h10V80h10v20h10v40h20V90h8V60h8v30h8v50h30v-30h20v-20h15v20h20v30h40V80h10V50h10v30h10v60h25V100h15V70h10v30h15v40h35v-50h20v-15h10v15h20v50h30V110h10V80h10v30h10v30h50v-40h15V90h10v20h15v40h20V100h20V75h10v25h20v50h30v-30h10V90h10v30h10v30h25V80h15V50h10v30h15v40h30V120h20V90h10v30h20v50h40V130h10V100h10v30h10v40h30v-50h10V90h10v30h10v50h20v-20h30v-30h10v30h30v20h40V140h10V110h10v30h10v60z"/>
		</svg>
	</div>

	<!-- Content — offset left, not dead center -->
	<div class="content">
		<div class="identity">
			<img src="/paw-logo.png" alt="Pawtropolis" class="logo" />
			<div class="text">
				<h1 class="title">Pawtropolis</h1>
				<p class="subtitle">A Safe Place For Everyone</p>
			</div>
		</div>

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

		<p class="footer">Staff access only</p>
	</div>
</div>

<style>
	.splash {
		position: relative;
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		background-color: var(--bg);
	}

	/* Atmospheric blobs */
	.blobs {
		position: absolute;
		inset: 0;
		transition: transform 0.15s ease-out;
		pointer-events: none;
	}

	.blob {
		position: absolute;
		border-radius: 50%;
		filter: blur(80px);
	}

	.blob-magenta {
		width: 500px;
		height: 500px;
		top: -5%;
		left: 5%;
		background: var(--brand-magenta);
		opacity: 0.08;
		animation: drift-1 25s ease-in-out infinite alternate;
	}

	.blob-cyan {
		width: 400px;
		height: 400px;
		bottom: 5%;
		right: 10%;
		background: var(--brand-cyan);
		opacity: 0.06;
		animation: drift-2 20s ease-in-out infinite alternate;
	}

	@keyframes drift-1 {
		0% { transform: translate(0, 0) scale(1); }
		100% { transform: translate(40px, 30px) scale(1.1); }
	}

	@keyframes drift-2 {
		0% { transform: translate(0, 0) scale(1); }
		100% { transform: translate(-30px, -20px) scale(0.9); }
	}

	/* Vignette — threshold depth, looking through an opening */
	.vignette {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: radial-gradient(
			ellipse 70% 60% at 50% 45%,
			transparent 0%,
			oklch(10% 0.01 var(--hue) / 0.3) 60%,
			oklch(8% 0.01 var(--hue) / 0.7) 100%
		);
	}

	/* Paint drip trails — extending the logo's dripping paint language */
	.drips {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
	}

	.drip {
		position: absolute;
		width: 2px;
		border-radius: 0 0 2px 2px;
		opacity: 0.12;
	}

	.drip-1 {
		left: 12%;
		top: 20%;
		height: 35%;
		background: linear-gradient(180deg, var(--brand-magenta), transparent);
	}

	.drip-2 {
		left: 8%;
		top: 35%;
		height: 25%;
		background: linear-gradient(180deg, var(--brand-cyan), transparent);
	}

	.drip-3 {
		right: 15%;
		top: 15%;
		height: 40%;
		background: linear-gradient(180deg, var(--brand-magenta), transparent);
		opacity: 0.08;
	}

	.drip-4 {
		right: 10%;
		top: 45%;
		height: 20%;
		background: linear-gradient(180deg, var(--brand-cyan), transparent);
		opacity: 0.1;
	}

	.drip-5 {
		left: 30%;
		top: 55%;
		height: 30%;
		width: 1px;
		background: linear-gradient(180deg, var(--brand-magenta), transparent);
		opacity: 0.06;
	}

	/* City skyline — faint silhouette at bottom */
	.skyline {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		height: 200px;
		opacity: 0.4;
		pointer-events: none;
	}

	.skyline svg {
		width: 100%;
		height: 100%;
	}

	/* Content — identity cluster with offset composition */
	.content {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2.5rem;
		padding-bottom: 4rem;
	}

	.identity {
		display: flex;
		align-items: center;
		gap: 2rem;
	}

	.logo {
		width: 180px;
		height: 180px;
		filter: drop-shadow(0 4px 24px oklch(50% 0.2 330 / 0.35));
		flex-shrink: 0;
	}

	.text {
		text-align: left;
	}

	.title {
		font-size: 3.5rem;
		font-weight: 800;
		color: var(--text-primary);
		letter-spacing: -0.03em;
		line-height: 1;
		margin-bottom: 0.5rem;
	}

	.subtitle {
		font-size: 1.1rem;
		color: var(--text-secondary);
		letter-spacing: 0.02em;
	}

	/* Discord button — magnetic tilt via JS, neumorphic shadows */
	.discord-btn {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 2.5rem;
		border-radius: var(--radius-md);
		background: linear-gradient(135deg, var(--brand-magenta), var(--brand-cyan));
		color: white;
		font-weight: 600;
		font-size: 1rem;
		text-decoration: none;
		overflow: hidden;
		transition: transform 0.15s var(--ease-smooth), box-shadow 0.25s var(--ease-smooth);
		transform: perspective(400px) rotateX(0) rotateY(0) scale(1);
		transform-style: preserve-3d;
		border: 1px solid oklch(40% 0.03 var(--hue) / 0.5);
		box-shadow:
			6px 6px 16px oklch(6% 0.01 var(--hue) / 0.6),
			-3px -3px 10px oklch(28% 0.02 var(--hue) / 0.2),
			inset 0 1px 0 oklch(90% 0.02 200 / 0.1);
	}

	.discord-btn:hover {
		box-shadow:
			8px 8px 20px oklch(5% 0.01 var(--hue) / 0.7),
			-4px -4px 12px oklch(30% 0.02 var(--hue) / 0.25),
			inset 0 1px 0 oklch(90% 0.02 200 / 0.12);
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
		font-size: 0.75rem;
		color: var(--text-secondary);
		opacity: 0.6;
	}

	/* Reduce motion */
	@media (prefers-reduced-motion: reduce) {
		.blob { animation: none; }
		.shimmer::after { animation: none; }
	}

	/* Responsive — stack vertically on smaller screens */
	@media (max-width: 640px) {
		.identity {
			flex-direction: column;
			text-align: center;
		}
		.text { text-align: center; }
		.logo { width: 140px; height: 140px; }
		.title { font-size: 2.5rem; }
	}
</style>
