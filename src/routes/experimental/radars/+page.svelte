<!--
	The radar experiment: the ground radars located from the replies they get (lib/radar),
	on a map of their own, with the overview or the selected radar's panel beside it. Laid
	out like the tracker (a map, the panel below it on phones, beside it from `md` on).
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import type { Unit } from '#lib/map/features.ts';
	import PageTitle from '../../PageTitle.svelte';
	import { getStreams } from '../../streams';
	import RadarMap from './RadarMap.svelte';
	import RadarOverview from './RadarOverview.svelte';
	import RadarPanel from './RadarPanel.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const streams = getStreams();
	const stream = streams.radars;
	const tracker = streams.tracker;

	// Collecting starts with the first visit, then goes on on every page (radar-stream.svelte.ts).
	onMount(() => stream.start());

	/** The tracker's NM/km choice (MapLayers.svelte), read only. */
	let unit = $state<Unit>('NM');
	onMount(() => {
		const saved = localStorage.getItem('tracker.unit');
		if (saved === 'NM' || saved === 'km') unit = saved;
	});

	/** The server's clock, once a second: for "3 s ago" (the map runs on its own). */
	let now = $state(Date.now());
	$effect(() => {
		const timer = setInterval(() => (now = stream.now()), 1000);
		return () => clearInterval(timer);
	});

	let selected = $derived(stream.get(stream.selected));
</script>

<PageTitle page="Radars (experimental)" />

<div class="flex h-full flex-col md:flex-row">
	<div class="relative min-h-0 flex-1">
		<RadarMap {stream} {tracker} receiver={data.reference} {unit} />
	</div>

	<aside
		class="max-h-[45dvh] shrink-0 overflow-y-auto border-t border-zinc-800 bg-zinc-950 pb-4 md:max-h-none md:w-104 md:border-t-0 md:border-l"
	>
		{#if selected}
			<RadarPanel
				radar={selected}
				codes={stream.codes}
				aircraft={tracker.aircraft}
				{now}
				receiver={data.reference}
				{unit}
				onselect={(icao) => streams.show(icao)}
				onselectradar={(id) => stream.select(id)}
				onclose={() => stream.select(null)}
			/>
		{:else}
			<RadarOverview
				radars={stream.radars}
				candidates={stream.candidates}
				codes={stream.codes}
				started={stream.started}
				{now}
				receiver={data.reference}
				{unit}
				onselectradar={(id) => stream.select(id)}
			/>
		{/if}
	</aside>
</div>
