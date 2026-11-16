<!--
	The tracker: live aircraft on a map, decoded in the browser from the raw frames (see
	tracker-stream.svelte.ts and lib/tracker). Unlike the data pages (/frames, /comm-b: 1024 px
	and up), this page works on phones too, down to 360 px: the map on top and the panel
	below it, side by side from `md` on.

	The panel shows the list, or a selected aircraft, or what was tapped on the map besides:
	the receiver (its coverage), a ground radar (experimental) or an airport. One at a time.
-->
<script lang="ts" module>
	import type { Unit } from '#lib/map/features.ts';

	/**
	 * Distances and speeds: nautical miles and knots, aviation's units, or km and km/h as a
	 * reference (the switch above the list, AircraftList.svelte). Module state, so it lasts
	 * while the tab is open, also across other pages, but isn't stored: a new visit starts in
	 * NM and kt again, the units to get used to. Only ever set in the browser (a click), so
	 * the server's renders all share 'NM'.
	 */
	let unit = $state<Unit>('NM');
	/**
	 * The aircraft list unfolded, on a phone (AircraftList.svelte): fold it to see more of the
	 * map. Not stored either: open again on a new visit.
	 */
	let listOpen = $state(true);
</script>

<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { lookupFlight, type DbFlight } from '#lib/aircraft-db.ts';
	import { RouteJudge } from '#lib/tracker/route.ts';
	import { layerAt, layers as profileLayers } from '#lib/weather/profile.ts';
	import AircraftList from './AircraftList.svelte';
	import AircraftPanel from './AircraftPanel.svelte';
	import AirportPanel from './AirportPanel.svelte';
	import AltitudeLegend from './AltitudeLegend.svelte';
	import CoveragePanel from './CoveragePanel.svelte';
	import MapLayers, { type Layers } from './MapLayers.svelte';
	import RadarPanel from './RadarPanel.svelte';
	import TrackerMap, { type Focus } from './TrackerMap.svelte';
	import PageTitle from './PageTitle.svelte';
	import { getStreams } from './streams';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const streams = getStreams();
	/** Collecting since the app opened, also while other pages were shown (streams.ts). */
	const stream = streams.tracker;
	/** The winds and temperatures the aircraft measure (/weather's pipeline): barbs, panel. */
	const weather = streams.weather;
	/** The antenna's coverage: collecting since the app opened. */
	const coverage = streams.coverage;
	/** The ground radars: searched for only while their layer is on. */
	const radars = streams.radars;

	/** What the map draws: ours on top of the aircraft, and parts of the base map (MapLayers.svelte). Remembered. */
	const LAYERS_KEY = 'tracker.layers';
	let layers = $state<Layers>({
		rings: true,
		trail: true,
		prediction: true,
		uncertainty: true,
		winds: true,
		coverage: false,
		radars: false,
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

	// The radar search runs only while its layer is on: it costs more than everything else.
	$effect(() => {
		const on = layers.radars;
		untrack(() => (on ? radars.start() : radars.stop()));
	});

	/**
	 * The receiver's or a radar's panel (tapped on the map). An aircraft's selection is the
	 * tracker's, so other pages and the alerts can set it; selecting one closes these.
	 */
	let focus = $state<Focus>(null);
	/** The direction picked on the receiver panel's sky plot (its wedge on the map). */
	let sector = $state<number | null>(null);
	function openFocus(next: Focus) {
		if (next) stream.select(null);
		focus = next;
		sector = null;
	}
	$effect(() => {
		if (stream.selected) focus = null;
	});
	// A tap on the map (aircraft, receiver, radar) opens its panel where the list was, so a
	// folded list unfolds; closing the panel then shows the list unfolded.
	$effect(() => {
		if (stream.selected || focus) listOpen = true;
	});
	let radar = $derived(focus?.kind === 'radar' ? radars.get(focus.id) : null);
	// The terrain (for the sky plot's skyline and the antenna's height) loads on first need.
	$effect(() => {
		if (layers.coverage || focus?.kind === 'receiver') untrack(() => coverage.start());
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
		<TrackerMap
			{stream}
			{weather}
			receiver={data.reference}
			{unit}
			{layers}
			{route}
			{coverage}
			{radars}
			{focus}
			{sector}
			onfocus={openFocus}
		/>

		<!-- Taps between the boxes go through to the map (on a phone this spans much of it).
		     Each box has a backdrop blur, so it's its own stacking context and a later box would
		     paint over an earlier box's tooltip: the one in use goes on top. -->
		<div
			class="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-3rem)] flex-wrap items-end gap-2 *:pointer-events-auto *:focus-within:z-10 *:hover:z-20"
		>
			<MapLayers bind:layers {radars} />
			<AltitudeLegend />
		</div>
	</div>

	<aside
		class={[
			'max-h-[45dvh] shrink-0 overflow-y-auto border-t border-zinc-800 bg-zinc-950 pb-4 md:max-h-none md:w-104 md:border-t-0 md:border-l',
			!listOpen && 'max-md:pb-2'
		]}
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
		{:else if focus?.kind === 'receiver'}
			<CoveragePanel
				stream={coverage}
				{unit}
				selected={sector}
				onselect={(i) => (sector = i)}
				onclose={() => openFocus(null)}
			/>
		{:else if focus?.kind === 'airport'}
			<AirportPanel
				airport={focus.airport}
				receiver={data.reference}
				{unit}
				onclose={() => openFocus(null)}
			/>
		{:else if radar}
			<RadarPanel
				{radar}
				radars={radars.radars}
				candidates={radars.candidates}
				codes={radars.codes}
				aircraft={stream.aircraft}
				{now}
				receiver={data.reference}
				{unit}
				onselect={(icao) => stream.select(icao)}
				onselectradar={(id) => openFocus({ kind: 'radar', id })}
				onclose={() => openFocus(null)}
			/>
		{:else}
			<AircraftList
				aircraft={stream.aircraft}
				{now}
				receiver={data.reference}
				bind:unit
				bind:open={listOpen}
				onselect={(icao) => stream.select(icao)}
			/>
		{/if}
	</aside>
</div>
