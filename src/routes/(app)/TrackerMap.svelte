<!--
	The map: base map (lib/map/style.ts), range rings around the receiver, trails, aircraft, the
	dotted predicted paths ahead of them and the circles of their position uncertainty (rings,
	trails, predictions, circles, wind barbs, and the base map's roads and place names can be
	switched off: MapLayers.svelte). MapLibre draws with WebGL from GeoJSON sources
	(lib/map/layers.ts: the sources, and the layers that draw them); this component keeps those
	sources up to date with the tracker. Aircraft, the pieces of trail up to them and the
	predictions move every animation frame (dead reckoning, lib/tracker/shown.ts); trails only
	change with new positions.

	The selected aircraft's route, if adsbdb knows it: a dashed great circle from origin to
	destination, with the airports' codes.

	Wind barbs (lib/map/winds.ts) where the aircraft measured the wind, from /weather's
	pipeline. Their images are drawn when first needed (missing style image resolver). Tap one for a card
	with its numbers. While an aircraft is selected, the barbs far from its level are dimmed:
	what's left is the wind it flies in.

	Alerts (lib/tracker/alerts.ts): a ring around the symbol in the alert's colour (red for an
	emergency, amber for a caution), its badge above the label, rings pulsing out when it
	starts, and a line between two aircraft in an ACAS advisory. Their trails stay on with the
	trail switch off. IDENT blinks the symbol. No pulsing or blinking for users who asked
	their system for less motion.

	Coverage (lib/map/coverage.ts, switched on in MapLayers or by opening the receiver's panel):
	an outline per altitude band out to the farthest position heard, and the radio horizon at
	FL350. With the panel open, also the positions behind it as dots, and the sector picked
	on its sky plot as a wedge.

	The ground radars (lib/map/radars.ts, experimental, off unless switched on): a symbol at
	each, its uncertainty ellipse, and its beam sweeping round as the fit predicts. With one
	open, the aircraft that answered it stand out.

	Satellite navigation (lib/map/gnss.ts, experimental, off unless switched on, though it
	collects all along): the grid's cells shaded by how many of their aircraft had no good
	GNSS, the stretches flown degraded, and where aircraft lost it and got it back.

	Tap or click an aircraft to select it, a radar, the receiver (the white dot) or an airport's
	label to open its panel; tap the map elsewhere to close them.
-->
<script lang="ts" module>
	import type { Airport } from '#lib/map/airports.ts';

	/**
	 * What the side panel shows besides an aircraft (whose selection is the tracker's). An
	 * airport comes whole: it's the tile's data, with no id to look it up by again.
	 */
	export type Focus =
		| { kind: 'receiver' }
		| { kind: 'radar'; id: string }
		| { kind: 'airport'; airport: Airport }
		/** A GNSS cell or change tapped (or picked from the panel's lists). */
		| { kind: 'gnss'; cell: string | null; change: number | null }
		| null;
</script>

<script lang="ts">
	import * as maplibregl from 'maplibre-gl';
	import type { GeoJSONSource } from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	// MapLibre parses tiles in a web worker, which it looks for next to its own file. Vite
	// bundles the library elsewhere, so tell it where the worker is (`?url`: Vite serves the
	// file as is in dev and copies it into the build).
	import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
	import { untrack } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import type { DbRoute } from '#lib/aircraft-db.ts';
	import type { LatLon } from '#lib/modes/cpr.ts';
	import {
		aircraftFeatures,
		alertLinkFeatures,
		headFeatures,
		predictionFeatures,
		ringFeatures,
		routeFeatures,
		TrailUpdates,
		uncertaintyFeatures
	} from '#lib/map/features.ts';
	import type { Unit } from '#lib/describe/format.ts';
	import { shownPosition } from '#lib/tracker/shown.ts';
	import { barbImage, iconImages } from '#lib/map/icons.ts';
	import { SECTOR_DEG } from '#lib/coverage/coverage.ts';
	import { radioHorizon } from '#lib/coverage/geometry.ts';
	import {
		HORIZON_FT,
		horizonFeatures,
		outlineFeatures,
		PointUpdates,
		sectorFeature
	} from '#lib/map/coverage.ts';
	import { beamFeatures, radarFeatures } from '#lib/map/radars.ts';
	import { cellFeatures, changeFeatures, stretchFeatures } from '#lib/map/gnss.ts';
	import { barbFeatures } from '#lib/map/winds.ts';
	import { MAP_ORIGINS, mapStyle } from '#lib/map/style.ts';
	import { themeColour } from '#lib/theme.ts';
	import { creditsCorner, foldCredits, watchBaseMap } from '#lib/map/base-map.ts';
	import { DEMO } from '#lib/demo/mode.ts';
	import { lngLat } from '#lib/map/geometry.ts';
	import {
		aircraftOpacity,
		LAYER_IDS,
		mapLayers,
		SOURCES,
		type Layers,
		trailPaint,
		type SourceId
	} from '#lib/map/layers.ts';
	import { pick, PICKABLE, type PickedBarb } from '#lib/map/pick.ts';
	import type { AlertCenter } from './alerts.svelte.ts';
	import type { CoverageStream } from './coverage-stream.svelte.ts';
	import type { GnssStream } from './gnss-stream.svelte.ts';
	import type { RadarStream } from './radar-stream.svelte.ts';
	import type { TrackerStream } from './tracker-stream.svelte.ts';
	import WindCard from './WindCard.svelte';
	import type { WeatherStream } from './weather/weather-stream.svelte.ts';

	interface Props {
		stream: TrackerStream;
		/** The winds the aircraft measured: the barbs. */
		weather: WeatherStream;
		receiver: LatLon;
		unit: Unit;
		layers: Layers;
		/** The selected aircraft's route (adsbdb); null: none. */
		route: DbRoute | null;
		/** The antenna's coverage: outlines, horizon, and the panel's dots and wedge. */
		coverage: CoverageStream;
		/** The ground radars (experimental). */
		radars: RadarStream;
		/** Satellite navigation (experimental). */
		gnss: GnssStream;
		/** The alerts in force: those aircraft keep their trails with the trail switch off. */
		alerts: AlertCenter;
		/** The receiver's or a radar's panel is open. */
		focus: Focus;
		/** The sector picked on the receiver panel's sky plot; null: none. */
		sector: number | null;
		/** A radar or the receiver tapped; null: the map elsewhere (closes the panel). */
		onfocus: (focus: Focus) => void;
	}

	let {
		stream,
		weather,
		receiver,
		unit,
		layers,
		route,
		coverage,
		radars,
		gnss,
		alerts,
		focus,
		sector,
		onfocus
	}: Props = $props();

	/** Barbs further than this from the selected aircraft's altitude are dimmed, ft. */
	const LEVEL_BAND_FT = 2000;
	/** Redraw the barbs at least this often, for the fading. */
	const BARB_REFRESH_MS = 10_000;
	/** Redraw the radar sites at least this often: one no longer heard dims. */
	const SITES_MS = 10_000;

	/** Set once the style has loaded and our sources and layers exist. */
	let map = $state<maplibregl.Map | null>(null);
	/** The base map's tiles don't load (lib/map/base-map.ts): no internet on this device? */
	let baseMapDown = $state(false);
	/** Why, as the browser put it (watchBaseMap). */
	let baseMapReason = $state<string | null>(null);

	/**
	 * The wind barb tapped last: its card shows its numbers (WindCard). Derived from the wind
	 * switch, so switching the barbs off (or on) closes the card; a tap sets it.
	 */
	let picked = $derived.by((): PickedBarb | null => {
		void layers.winds;
		return null;
	});

	/** Redraw moving aircraft at most this often: smooth enough, and cheap. */
	const FRAME_MS = 50;

	const reducedMotion = new MediaQuery('prefers-reduced-motion: reduce');

	/** The aircraft with alerts, as one string: the trail filter only changes when it does. */
	let alerting = $derived([...new Set(alerts.alerts.map((x) => x.icao))].sort().join(' '));

	const source = (m: maplibregl.Map, id: SourceId) => m.getSource(id) as GeoJSONSource;
	const empty = { type: 'FeatureCollection' as const, features: [] };

	maplibregl.setWorkerUrl(workerUrl);

	function create(container: HTMLDivElement) {
		const center = untrack(() => receiver);
		const m = new maplibregl.Map({
			container,
			style: mapStyle(),
			center: lngLat(center),
			zoom: 7,
			// Added below, in a corner that depends on the map's width.
			attributionControl: false,
			// Rotating the map would make "north up" and the tracks confusing; pinch-zoom stays.
			dragRotate: false,
			pitchWithRotate: false,
			touchPitch: false,
			// No fading labels. MapLibre tells labels apart by their text, so when FL123 turns
			// into FL124 it sees a new label and fades it in from nothing: a climbing aircraft's
			// label would flicker with every 100 ft. Base map labels now appear without a fade too.
			fadeDuration: 0
		});
		m.touchZoomRotate.disableRotation();
		m.addControl(new maplibregl.AttributionControl({ compact: true }), creditsCorner(container));
		let unfold = () => {};
		const unwatch = watchBaseMap(m, (down, reason) => {
			baseMapDown = down;
			baseMapReason = reason;
		});

		// Wind barbs: one image per speed (in 5 kt steps) and hemisphere, drawn on first use.
		// A resolver, not the styleimagemissing event: since MapLibre 6 an image added by the
		// event's listener only shows from the next redraw on (and MapLibre warns).
		m.setMissingStyleImageResolver((id) => {
			const barb = barbImage(id);
			if (barb && !m.hasImage(id))
				m.addImage(id, barb.image, { sdf: true, pixelRatio: barb.pixelRatio });
		});

		m.on('load', () => {
			for (const { name, image, pixelRatio } of iconImages())
				m.addImage(name, image, { sdf: true, pixelRatio });

			for (const id of SOURCES) m.addSource(id, { type: 'geojson', data: empty });

			for (const layer of mapLayers(themeColour)) m.addLayer(layer);

			// What was tapped (lib/map/pick.ts) opens its panel or card; the map itself closes them.
			m.on('click', (e) => {
				const hit = pick(m, e.point, layers);
				picked = hit?.kind === 'barb' ? hit : null;
				switch (hit?.kind) {
					case 'aircraft':
						return stream.select(hit.icao);
					case 'radar':
						return onfocus({ kind: 'radar', id: hit.id });
					case 'gnss-change':
						return onfocus({ kind: 'gnss', cell: null, change: hit.id });
					case 'gnss-cell':
						return onfocus({ kind: 'gnss', cell: hit.key, change: null });
					case 'receiver':
						return onfocus({ kind: 'receiver' });
					case 'airport':
						return onfocus({ kind: 'airport', airport: hit.airport });
					case undefined:
						stream.select(null);
						onfocus(null);
				}
			});
			for (const id of PICKABLE) {
				m.on('mouseenter', id, () => (m.getCanvas().style.cursor = 'pointer'));
				m.on('mouseleave', id, () => (m.getCanvas().style.cursor = ''));
			}

			unfold = foldCredits(m, container);

			map = m;
		});

		return () => {
			unfold();
			unwatch();
			map = null;
			m.remove();
		};
	}

	// The receiver and the range rings: when the unit changes.
	$effect(() => {
		if (!map) return;
		const { rings, labels } = ringFeatures(receiver, unit);
		source(map, 'rings').setData(rings);
		source(map, 'ring-labels').setData(labels);
		source(map, 'receiver').setData({
			type: 'Feature',
			properties: {},
			geometry: { type: 'Point', coordinates: lngLat(receiver) }
		});
	});

	// Coverage: the outlines when an extreme moves (at most once a second), the horizon when
	// the antenna's height comes in with the terrain. Only while shown.
	let coverageShown = $derived(layers.coverage || focus?.kind === 'receiver');
	$effect(() => {
		if (!map || !coverageShown) return;
		source(map, 'coverage-outline').setData(outlineFeatures(coverage.sectors, receiver));
		source(map, 'coverage-horizon').setData(
			horizonFeatures(receiver, HORIZON_FT, coverage.terrain?.antennaKm ?? 0)
		);
	});
	// The panel's extras: the positions behind the outlines (only what changed: there are
	// tens of thousands), and the sector picked on its plot.
	const pointUpdates = new PointUpdates();
	let pointsShown = false;
	$effect(() => {
		const points = focus?.kind === 'receiver' ? coverage.points : null;
		if (!map) return;
		if (!points) {
			if (pointsShown) source(map, 'coverage-points').setData(empty);
			pointsShown = false;
			pointUpdates.reset();
			return;
		}
		pointsShown = true;
		const diff = pointUpdates.next(points);
		if (diff) source(map, 'coverage-points').updateData(diff).catch(console.error);
	});
	$effect(() => {
		const open = focus?.kind === 'receiver';
		if (!map) return;
		source(map, 'coverage-sector').setData(
			open && sector !== null
				? sectorFeature(
						receiver,
						sector * SECTOR_DEG,
						radioHorizon(HORIZON_FT, coverage.terrain?.antennaKm ?? 0)
					)
				: empty
		);
		map.setLayoutProperty('receiver-selected', 'visibility', open ? 'visible' : 'none');
	});

	// The open airport's ring.
	$effect(() => {
		const airport = focus?.kind === 'airport' ? focus.airport : null;
		if (!map) return;
		source(map, 'airport-selected').setData(
			airport
				? {
						type: 'Feature',
						properties: {},
						geometry: { type: 'Point', coordinates: lngLat(airport) }
					}
				: empty
		);
	});

	// Radar sites and ellipses: when one is confirmed, refitted or dropped, the panel opens or
	// closes, and every SITES_MS (a radar no longer heard dims).
	let openRadar = $derived(focus?.kind === 'radar' ? focus.id : null);
	let sitesClock = $state(0);
	$effect(() => {
		const timer = setInterval(() => (sitesClock = Date.now()), SITES_MS);
		return () => clearInterval(timer);
	});
	$effect(() => {
		void sitesClock;
		const list = radars.radars;
		const id = openRadar;
		if (!map) return;
		const { sites, ellipses } = radarFeatures(
			list,
			id,
			untrack(() => stream.now())
		);
		source(map, 'radar-sites').setData(sites);
		source(map, 'radar-ellipses').setData(ellipses);
	});

	// A radar opened from the panel's list, but off screen: bring it into view. Only when the
	// panel changes, not with every refit (the map would keep pulling back to it).
	$effect(() => {
		const id = openRadar;
		const m = map;
		if (!m || !id) return;
		untrack(() => {
			const radar = radars.get(id);
			if (radar && !m.getBounds().contains(lngLat(radar.position)))
				m.easeTo({ center: lngLat(radar.position) });
		});
	});

	// With a radar open, the aircraft that answered it stand out.
	let answered = $derived(
		radars
			.get(openRadar)
			?.aircraft.filter((a) => a.explained > 0)
			.map((a) => a.icao) ?? null
	);
	$effect(() => {
		const icaos = answered;
		if (!map) return;
		map.setPaintProperty('aircraft', 'icon-opacity', aircraftOpacity(icaos));
	});

	// GNSS: each source when the watch publishes a change to it (every few seconds at most)
	// or the panel's focus changes. Only while shown: switched on, the effects run again and
	// draw at once.
	let gnssFocus = $derived(focus?.kind === 'gnss' ? focus : null);
	let gnssCell = $derived(gnssFocus?.cell ?? null);
	let gnssChange = $derived(gnssFocus?.change ?? null);
	$effect(() => {
		const { cells } = gnss;
		const cell = gnssCell;
		if (!map || !layers.gnss) return;
		source(map, 'gnss-cells').setData(cellFeatures(cells, cell));
	});
	$effect(() => {
		const { stretches } = gnss;
		if (!map || !layers.gnss) return;
		source(map, 'gnss-stretches').setData(stretchFeatures(stretches));
	});
	$effect(() => {
		const { changes } = gnss;
		const change = gnssChange;
		if (!map || !layers.gnss) return;
		const { points, blind } = changeFeatures(changes, change);
		source(map, 'gnss-changes').setData(points);
		source(map, 'gnss-blind').setData(blind);
	});

	// A change picked in the panel's list, but off screen: bring it into view (once).
	$effect(() => {
		const id = gnssFocus?.change ?? null;
		const m = map;
		if (!m || id === null) return;
		untrack(() => {
			const at = gnss.changes.find((c) => c.id === id)?.at;
			if (at && !m.getBounds().contains(lngLat(at))) m.easeTo({ center: lngLat(at) });
		});
	});

	// The selected aircraft's route: when it's looked up or the selection changes.
	$effect(() => {
		const { line, airports } = routeFeatures(route);
		if (!map) return;
		source(map, 'route').setData(line);
		source(map, 'route-airports').setData(airports);
	});

	// Wind barbs: when a wind comes in, and every BARB_REFRESH_MS for the fading.
	let barbClock = $state(0);
	$effect(() => {
		const timer = setInterval(() => (barbClock = Date.now()), BARB_REFRESH_MS);
		return () => clearInterval(timer);
	});
	$effect(() => {
		void barbClock;
		// Hidden while switched off; switched on, this runs again and draws them at once.
		if (!layers.winds) return;
		const winds = weather.correctedWinds;
		const checks = weather.checks;
		if (!map) return;
		// The clock alone mustn't redraw them: it moves with every update (4 a second).
		const now = untrack(() => weather.now);
		source(map, 'winds').setData(barbFeatures(winds, checks, now));
	});

	// With an aircraft selected: the barbs near its level stay, the others are dimmed.
	let selectedLevel = $derived.by(() => {
		const feet = stream.get(stream.selected)?.altitude?.value;
		return feet === undefined ? null : Math.round(feet / 500) * 500;
	});
	$effect(() => {
		const level = selectedLevel;
		if (!map) return;
		map.setPaintProperty(
			'winds',
			'icon-opacity',
			level === null
				? ['get', 'opacity']
				: [
						'*',
						['get', 'opacity'],
						['case', ['<=', ['abs', ['-', ['get', 'altitude'], level]], LEVEL_BAND_FT], 1, 0.3]
					]
		);
	});

	// Trails: with every update from the tracker, only the lines that changed.
	const trailUpdates = new TrailUpdates();
	$effect(() => {
		const list = stream.aircraft;
		if (!map) return;
		const diff = trailUpdates.next(list, stream.now());
		if (diff) source(map, 'trails').updateData(diff).catch(console.error);
	});

	// What moves with the aircraft, drawn every animation frame (throttled): the aircraft, the
	// trail pieces up to them, the alert links, and if switched on the predictions, the
	// uncertainty circles and the radar beams. A switched-off one is emptied once and then
	// skipped (20 times a second for nothing shown), so it never shows stale data when it's
	// switched on again: the switches' effect then draws it at once.
	let predictionDrawn = false;
	let uncertaintyDrawn = false;
	let beamsDrawn = false;
	function drawMoving(m: maplibregl.Map) {
		const list = stream.aircraft;
		const now = stream.now();
		source(m, 'aircraft').setData(aircraftFeatures(list, now, !reducedMotion.current));
		source(m, 'alert-links').setData(alertLinkFeatures(list, now));
		source(m, 'heads').setData(headFeatures(list, now));
		if (layers.prediction) {
			const prediction = predictionFeatures(list, now, stream.selected);
			source(m, 'prediction').setData(prediction.lines);
			source(m, 'prediction-minutes').setData(prediction.minutes);
			predictionDrawn = true;
		} else if (predictionDrawn) {
			source(m, 'prediction').setData(empty);
			source(m, 'prediction-minutes').setData(empty);
			predictionDrawn = false;
		}
		if (layers.uncertainty) {
			source(m, 'uncertainty').setData(uncertaintyFeatures(list, now));
			uncertaintyDrawn = true;
		} else if (uncertaintyDrawn) {
			source(m, 'uncertainty').setData(empty);
			uncertaintyDrawn = false;
		}
		// The beams sweep: none for those who asked for less motion.
		if (layers.radars && !reducedMotion.current) {
			source(m, 'radar-beams').setData(beamFeatures(radars.radars, openRadar, now));
			beamsDrawn = true;
		} else if (beamsDrawn) {
			source(m, 'radar-beams').setData(empty);
			beamsDrawn = false;
		}
	}
	$effect(() => {
		const m = map;
		if (!m) return;
		let frame = 0;
		let last = 0;
		const draw = (time: number) => {
			frame = requestAnimationFrame(draw);
			if (time - last < FRAME_MS) return;
			last = time;
			drawMoving(m);
		};
		frame = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(frame);
	});

	// The switches: show or hide their layers. The moving ones are drawn at once (or emptied),
	// not at the next frame: they're skipped while off.
	$effect(() => {
		const m = map;
		if (!m) return;
		for (const [key, ids] of Object.entries(LAYER_IDS)) {
			const on = key === 'coverage' ? coverageShown : layers[key as keyof Layers];
			for (const id of ids) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
		}
		untrack(() => drawMoving(m));
	});

	// The selection: a ring around the symbol, its trail brighter and wider. With the trails
	// switched off, its trail is the only one, with those of aircraft with an alert.
	$effect(() => {
		const icao = stream.selected ?? '';
		const shown = [icao, ...alerting.split(' ')].filter(Boolean);
		if (!map) return;
		map.setFilter('selected', ['==', ['get', 'icao'], icao]);
		const mine = ['==', ['get', 'icao'], icao] as maplibregl.ExpressionSpecification;
		const kept = ['in', ['get', 'icao'], ['literal', shown]] as maplibregl.ExpressionSpecification;
		const paint = trailPaint(icao || null);
		for (const id of ['trails', 'heads']) {
			map.setFilter(id, layers.trail ? null : kept);
			map.setPaintProperty(id, 'line-width', paint['line-width']);
			map.setPaintProperty(id, 'line-opacity', paint['line-opacity']);
		}
		map.setPaintProperty('prediction', 'line-width', ['case', mine, 2.5, 1.5]);
		map.setPaintProperty('prediction', 'line-opacity', ['case', mine, 0.9, icao ? 0.3 : 0.75]);
	});

	// Selected from the list, but off screen: bring it into view.
	$effect(() => {
		const icao = stream.selected;
		const m = map;
		if (!m || !icao) return;
		untrack(() => {
			const a = stream.get(icao);
			const p = a && shownPosition(a, stream.now());
			if (p && !m.getBounds().contains(lngLat(p))) m.easeTo({ center: lngLat(p) });
		});
	});

	// Once, when the first aircraft are in: zoom to show them all, and the receiver.
	let fitted = false;
	$effect(() => {
		const list = stream.aircraft;
		const m = map;
		if (!m || fitted) return;
		const now = stream.now();
		const points = list.flatMap((a) => shownPosition(a, now) ?? []);
		if (points.length === 0) return;
		fitted = true;
		const bounds = new maplibregl.LngLatBounds();
		for (const p of [...points, receiver]) bounds.extend(lngLat(p));
		m.fitBounds(bounds, { padding: 60, maxZoom: 8, duration: 0 });
	});
</script>

<!-- crossorigin: MapLibre fetches tiles in CORS mode, which needs a connection of its own. -->
<svelte:head>
	{#each MAP_ORIGINS as origin (origin)}
		<link rel="preconnect" href={origin} crossorigin="anonymous" />
	{/each}
</svelte:head>

<!-- MapLibre makes its container `position: relative` (unlayered CSS, so it beats Tailwind's
     `absolute`): the positioning goes on a wrapper. -->
<div class="absolute inset-0">
	<div class="h-full w-full" {@attach create}></div>

	{#if baseMapDown}
		<!-- Below the alert banner, if one floats over the map. -->
		<p
			class="absolute top-[calc(0.75rem+var(--alert-banner,0px))] left-1/2 z-10 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900/95 px-3 py-2 text-sm text-zinc-300 shadow-xl"
			role="status"
		>
			No map: the map from OpenFreeMap didn't load (no internet, or a content blocker stopping it).
			{DEMO
				? 'The aircraft still show: they come from the recording.'
				: 'The aircraft are live: they come from the receiver.'}
			{#if baseMapReason}
				<span class="mt-1 block font-mono text-xs break-all text-zinc-500">{baseMapReason}</span>
			{/if}
		</p>
	{/if}

	{#if picked && map}
		<WindCard {map} {picked} {stream} {weather} onclose={() => (picked = null)} />
	{/if}
</div>
