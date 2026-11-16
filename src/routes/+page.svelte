<!--
	The tracker: live aircraft on a map, decoded in the browser from the raw frames (see
	tracker-stream.svelte.ts and lib/tracker). Unlike the data pages (/frames, /comm-b: 1024 px
	and up), this page works on phones too, down to 360 px: the map on top and the panel
	below it, side by side from `md` on.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { lookupFlight, type DbFlight } from '#lib/aircraft-db.ts';
	import { RouteJudge } from '#lib/tracker/route.ts';
	import type { Unit } from '#lib/map/features.ts';
	import { layerAt, layers as profileLayers } from '#lib/weather/profile.ts';
	import AircraftList from './AircraftList.svelte';
	import AircraftPanel from './AircraftPanel.svelte';
	import AltitudeLegend from './AltitudeLegend.svelte';
	import MapLayers, { type Layers } from './MapLayers.svelte';
	import TrackerMap from './TrackerMap.svelte';
	import PageTitle from './PageTitle.svelte';
	import { getStreams } from './streams';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Collecting since the app opened, also while other pages were shown (streams.ts). */
	const stream = getStreams().tracker;
	/** The winds and temperatures the aircraft measure (/weather's pipeline): barbs, panel. */
	const weather = getStreams().weather;

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

	/** What the map draws: ours on top of the aircraft, and parts of the base map (MapLayers.svelte). Remembered. */
	const LAYERS_KEY = 'tracker.layers';
	let layers = $state<Layers>({
		rings: true,
		trail: true,
		prediction: true,
		uncertainty: true,
		winds: true,
		roads: true,
		places: true
	});
	let layersLoaded = false;
	onMount(() => {
		try {
			const saved = JSON.parse(localStorage.getItem(LAYERS_KEY) ?? 'null');
			for (const key of Object.keys(layers) as (keyof Layers)[])
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
	/** /weather's temperature profile, for the contrail line (read only with a selection). */
	let temperatureLayers = $derived(profileLayers(weather.sky.temperatures, [], []));
	let selectedWeather = $derived.by(() => {
		const icao = selected?.icao;
		const aircraft = icao && weather.aircraft.find((a) => a.icao === icao);
		if (!aircraft) return null;
		const feet = aircraft.lastTemperature?.inputs.altitude?.feet;
		return {
			aircraft,
			check: weather.checks.get(aircraft.icao) ?? null,
			layer: feet === undefined ? null : layerAt(temperatureLayers, feet)
		};
	});

	/**
	 * What adsbdb knows about the selected aircraft's flight: route and airline, by its
	 * callsign (lib/aircraft-db.ts). For both the panel and the map (the route's line). Only
	 * the selected one is looked up: adsbdb is a free service run by one person.
	 */
	let callsign = $derived(selected?.callsign?.value ?? null);
	let flight = $state<DbFlight | null>(null);
	$effect(() => {
		const cs = callsign;
		flight = null;
		if (!cs) return;
		let current = true;
		lookupFlight(cs).then(
			(f) => {
				if (current) flight = f;
			},
			// Offline or adsbdb down: no route; the next selection retries.
			() => {}
		);
		return () => (current = false);
	});

	/**
	 * Does the route fit what the aircraft does (lib/tracker/route.ts)? One that doesn't is
	 * dismissed (most likely another flight's): not drawn, and "unknown" in the panel. The
	 * judge remembers that, so the route doesn't come back as the aircraft turns.
	 */
	const judge = new RouteJudge();
	let judged = $derived(selected && flight?.route ? judge.judge(selected, flight.route) : null);
	let route = $derived(judged?.shown ? (flight?.route ?? null) : null);
</script>

<PageTitle page="Tracker" />

<div class="flex h-full flex-col md:flex-row">
	<div class="relative min-h-0 flex-1">
		<TrackerMap {stream} {weather} receiver={data.reference} {unit} {layers} {route} />

		<!-- Taps between the boxes go through to the map (on a phone this spans much of it).
		     Each box has a backdrop blur, so it's its own stacking context and a later box would
		     paint over an earlier box's tooltip: the one in use goes on top. -->
		<div
			class="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-3rem)] flex-wrap items-end gap-2 *:pointer-events-auto *:focus-within:z-10 *:hover:z-20"
		>
			<MapLayers bind:layers bind:unit receiver={!!data.reference} />
			<AltitudeLegend />
		</div>
	</div>

	<aside
		class="max-h-[45dvh] shrink-0 overflow-y-auto border-t border-zinc-800 bg-zinc-950 pb-4 md:max-h-none md:w-104 md:border-t-0 md:border-l"
	>
		{#if selected}
			<!-- Keyed: another aircraft gets a fresh panel (e.g. its own paused feed). -->
			{#key selected.icao}
				<AircraftPanel
					aircraft={selected}
					all={stream.aircraft}
					messages={stream.messages}
					{flight}
					{judged}
					weather={selectedWeather}
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
