<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<title>Pawtropolis</title>
	<meta name="description" content="Pawtropolis moderator dashboard" />
</svelte:head>

{@render children()}
