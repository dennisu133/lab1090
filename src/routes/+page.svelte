<!--
	The tracker: live aircraft on a map, decoded in the browser from the raw frames (see
	tracker-stream.svelte.ts and lib/tracker). Unlike the data pages (/frames, /comm-b: 1024 px
	and up), this page works on phones too, down to 360 px: the map on top and the panel
	below it, side by side from `md` on.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import type { Unit } from '#lib/map/features.ts';
	import AircraftList from './AircraftList.svelte';
	import AircraftPanel from './AircraftPanel.svelte';
	import AltitudeLegend from './AltitudeLegend.svelte';
	import MapLayers, { type Layers } from './MapLayers.svelte';
	import TrackerMap from './TrackerMap.svelte';
	import { getStreams } from './streams';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Collecting since the app opened, also while other pages were shown (streams.ts). */
	const stream = getStreams().tracker;

	/**
	 * Range rings and distances: nautical miles (aviation's unit) or km, switched next to
	 * the rings (MapLayers.svelte). Remembered.
	 */
	const UNIT_KEY = 'tracker.unit';
	let unit = $state<Unit>('NM');
	let unitLoaded = false;
	onMount(() => {
		const saved = localStorage.getItem(UNIT_KEY);
		if (saved === 'NM' || saved === 'km') unit = saved;
		unitLoaded = true;
	});
	$effect(() => {
		const u = unit;
		if (unitLoaded) localStorage.setItem(UNIT_KEY, u);
	});

	/** What the map draws on top of the aircraft (MapLayers.svelte). Remembered. */
	const LAYERS_KEY = 'tracker.layers';
	let layers = $state<Layers>({ rings: true, trail: true, prediction: true, uncertainty: true });
	let layersLoaded = false;
	onMount(() => {
		try {
			const saved = JSON.parse(localStorage.getItem(LAYERS_KEY) ?? 'null');
			for (const key of ['rings', 'trail', 'prediction', 'uncertainty'] as const)
				if (typeof saved?.[key] === 'boolean') layers[key] = saved[key];
		} catch {
			// Not ours or broken: keep the defaults.
		}
		layersLoaded = true;
	});
	$effect(() => {
		const json = JSON.stringify(layers);
		if (layersLoaded) localStorage.setItem(LAYERS_KEY, json);
	});

	/** The server's clock, once a second: for "3 s ago" and the list (the map runs on its own). */
	let now = $state(Date.now());
	$effect(() => {
		const timer = setInterval(() => (now = stream.now()), 1000);
		return () => clearInterval(timer);
	});

	let selected = $derived(stream.get(stream.selected));
</script>

<svelte:head>
	<title>Tracker · Ten Ninety</title>
</svelte:head>

<div class="flex h-full flex-col md:flex-row">
	<div class="relative min-h-0 flex-1">
		<TrackerMap {stream} receiver={data.reference} {unit} {layers} />

		<div class="absolute bottom-2 left-2 flex max-w-[calc(100%-3rem)] flex-wrap items-end gap-2">
			<MapLayers bind:layers bind:unit receiver={!!data.reference} />
			<AltitudeLegend />
		</div>
	</div>

	<aside
		class="max-h-[45dvh] shrink-0 overflow-y-auto border-t border-zinc-800 bg-zinc-950 pb-4 md:max-h-none md:w-[26rem] md:border-t-0 md:border-l"
	>
		{#if selected}
			<!-- Keyed: another aircraft gets a fresh panel (e.g. its own paused feed). -->
			{#key selected.icao}
				<AircraftPanel
					aircraft={selected}
					messages={stream.messages}
					{now}
					receiver={data.reference}
					{unit}
					onclose={() => stream.select(null)}
				/>
			{/key}
		{:else}
			<AircraftList
				aircraft={stream.aircraft}
				{now}
				receiver={data.reference}
				{unit}
				onselect={(icao) => stream.select(icao)}
			/>
		{/if}
	</aside>
</div>
