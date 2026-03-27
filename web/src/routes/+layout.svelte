<script lang="ts">
	import '../app.css';
	import CookieConsent from '$lib/components/feedback/CookieConsent.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<title>Pawtropolis</title>
	<meta name="description" content="Moderator dashboard for the Pawtropolis Discord community" />

	<!-- Open Graph (Discord, Slack, Facebook, etc.) -->
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Pawtropolis" />
	<meta property="og:title" content="Pawtropolis" />
	<meta property="og:description" content="Moderator dashboard for the Pawtropolis Discord community" />
	<meta property="og:image" content="https://pawtropolis.tech/og-image.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:url" content="https://pawtropolis.tech" />

	<!-- Twitter / X Card -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="Pawtropolis" />
	<meta name="twitter:description" content="Moderator dashboard for the Pawtropolis Discord community" />
	<meta name="twitter:image" content="https://pawtropolis.tech/og-image.png" />
</svelte:head>

{@render children()}

<CookieConsent />
