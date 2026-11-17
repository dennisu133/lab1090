<!--
	The window title, "Tracker · lab1090", with the most important alert in front while
	there is one ("⚠ 7700 AUA98F · Tracker · lab1090"): for a window left open on a second
	screen, where the tab is often all that shows. Also for alerts whose banner was hidden.
-->
<script lang="ts">
	import { badge, nameOf } from '#lib/describe/alert.ts';
	import { getStreams } from './streams';

	let { page }: { page: string } = $props();

	const streams = getStreams();
	let alert = $derived(streams.alerts.alerts[0] ?? null);
	let prefix = $derived(
		alert ? `⚠ ${badge(alert)} ${nameOf(streams.tracker.get(alert.icao), alert.icao)} · ` : ''
	);
</script>

<svelte:head>
	<title>{prefix}{page} · lab1090</title>
</svelte:head>
