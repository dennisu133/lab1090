<!--
	The root: styles, the icon, the fonts and the description, nothing else. The app itself, with the
	navigation and the live streams, is the (app) group's layout; /setup stands outside it,
	because the streams need the receiver's position and /setup is where it comes from.
-->
<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import sans from '#lib/assets/fonts/hyperlegible-open.woff2';
	import mono from '#lib/assets/fonts/hyperlegible-open-mono.woff2';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href={favicon} />
	<!-- Every page's text: requested with the page instead of once the stylesheet names them
	     (theme.css), so the text is usually drawn in them from the start, not redrawn in them
	     a moment later, with other widths. crossorigin: fonts are always fetched in CORS mode. -->
	{#each [sans, mono] as font (font)}
		<link rel="preload" href={font} as="font" type="font/woff2" crossorigin="anonymous" />
	{/each}
	<meta
		name="description"
		content="lab1090 decodes live Mode S and ADS-B from an RTL-SDR, from the raw radio samples up: a tracker map, every frame as it arrives, Comm-B registers, weather from aircraft and the receiver's health."
	/>
</svelte:head>

{@render children()}
