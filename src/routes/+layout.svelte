<!--
	The root: styles, the icon and the description, nothing else. The app itself, with the
	navigation and the live streams, is the (app) group's layout; /setup stands outside it,
	because the streams need the receiver's position and /setup is where it comes from.
-->
<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href={favicon} />
	<meta
		name="description"
		content="lab1090 decodes live Mode S and ADS-B from an RTL-SDR, from the raw radio samples up: a tracker map, every frame as it arrives, Comm-B registers, weather from aircraft and the receiver's health."
	/>
</svelte:head>

{@render children()}
