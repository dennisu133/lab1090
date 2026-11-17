<!--
	The root: styles and the icon, nothing else. The app itself, with the navigation and the
	live streams, is the (app) group's layout; /setup stands outside it, because the streams
	need the receiver's position and /setup is where it comes from.
-->
<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href={favicon} />
</svelte:head>

{@render children()}
