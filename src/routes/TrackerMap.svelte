<!--
	The map: base map (lib/map/style.ts), range rings around the receiver, trails, aircraft
	the dotted predicted paths ahead of them and the circles of their position uncertainty
	(rings, trails, predictions, circles, wind barbs, and the base map's roads and place names
	can be switched off: MapLayers.svelte). MapLibre
	draws with WebGL from GeoJSON sources; this component keeps those sources up to date with
	the tracker. Aircraft, the pieces of trail up to them and the predictions move every
	animation frame (dead
	reckoning, lib/map/features.ts); trails only change with new positions.

	The selected aircraft's route, if adsbdb knows it: a dashed great circle from origin to
	destination, with the airports' codes.

	Wind barbs (lib/map/winds.ts) where the aircraft measured the wind, from /weather's
	pipeline. Their images are drawn when first needed (styleimagemissing). Tap one for a card
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
		| null;
</script>

<script lang="ts">
	import * as maplibregl from 'maplibre-gl';
	import type { GeoJSONSource, LngLatLike, MapMouseEvent } from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	// MapLibre parses tiles in a web worker, which it looks for next to its own file. Vite
	// bundles the library elsewhere, so tell it where the worker is (`?url`: Vite serves the
	// file as is in dev and copies it into the build).
	import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
	import { untrack } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import type { DbRoute } from '#lib/aircraft-db.ts';
	import type { LatLon } from '#lib/modes/cpr.ts';
	import { airportFrom } from '#lib/map/airports.ts';
	import { altitudeColour } from '#lib/map/altitude.ts';
	import { activeAlerts } from '#lib/tracker/alerts.ts';
	import {
		aircraftFeatures,
		alertLinkFeatures,
		flightLevel,
		headFeatures,
		predictionFeatures,
		ringFeatures,
		routeFeatures,
		shownPosition,
		STALE_OPACITY,
		trailFeatures,
		uncertaintyFeatures,
		type Unit
	} from '#lib/map/features.ts';
	import { barbImage, iconImages } from '#lib/map/icons.ts';
	import { SECTOR_DEG } from '#lib/coverage/coverage.ts';
	import { radioHorizon } from '#lib/coverage/geometry.ts';
	import {
		HORIZON_FT,
		horizonFeatures,
		outlineFeatures,
		pointFeatures,
		sectorFeature
	} from '#lib/map/coverage.ts';
	import { beamFeatures, radarFeatures } from '#lib/map/radars.ts';
	import { BARB_BELOW, barbFeatures, type BarbProperties } from '#lib/map/winds.ts';
	import { compass } from '#lib/geo.ts';
	import { degrees } from '#lib/describe/weather.ts';
	import { MIN_CORRECTION } from '#lib/weather/headings.ts';
	import { mapStyle } from '#lib/map/style.ts';
	import type { CoverageStream } from './coverage-stream.svelte.ts';
	import type { Layers } from './MapLayers.svelte';
	import type { RadarStream } from './radar-stream.svelte.ts';
	import type { TrackerStream } from './tracker-stream.svelte.ts';
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
		focus,
		sector,
		onfocus
	}: Props = $props();

	/** The map layers each switch shows or hides. The trail switch filters instead (below). */
	const LAYER_IDS: Record<Exclude<keyof Layers, 'trail'>, string[]> = {
		prediction: ['prediction', 'prediction-ticks', 'prediction-minutes'],
		uncertainty: ['accuracy', 'containment', 'uncertainty-unknown'],
		rings: ['rings', 'ring-labels'],
		winds: ['winds'],
		// Also shown while the receiver's panel is open (see the switches' effect).
		coverage: ['coverage-horizon', 'coverage-horizon-label', 'coverage-fill', 'coverage-outline'],
		radars: ['radar-ellipse-fill', 'radar-ellipses', 'radar-beams', 'radar-sites'],
		// The base map's own layers (lib/map/style.ts). Borders, terrain and airports always stay.
		roads: ['roads', 'motorways'],
		places: ['places']
	};

	/** Barbs further than this from the selected aircraft's altitude are dimmed, ft. */
	const LEVEL_BAND_FT = 2000;
	/** Redraw the barbs at least this often, for the fading. */
	const BARB_REFRESH_MS = 10_000;
	/** Redraw the radar sites at least this often: one no longer heard dims. */
	const SITES_MS = 10_000;
	/** The horizon's amber (amber-300), as on the sky plot. */
	const HORIZON_COLOUR = '#fcd34d';

	/** The barb tapped last, and where on the map it is; its card shows its numbers. */
	let picked = $state<{ barb: BarbProperties; lon: number; lat: number } | null>(null);
	/** Where the card's point is on screen, px; follows the map as it moves. */
	let pickedAt = $state<{ x: number; y: number; width: number } | null>(null);

	/** Set once the style has loaded and our sources and layers exist. */
	let map = $state<maplibregl.Map | null>(null);

	/** Redraw moving aircraft at most this often: smooth enough, and cheap. */
	const FRAME_MS = 50;
	const FONT = ['Noto Sans Regular'];
	const HALO = '#09090b';
	/** Alert colours: red-500 for emergencies, amber-400 for cautions (as the banner). */
	const TIER_COLOUR: maplibregl.ExpressionSpecification = [
		'match',
		['get', 'tier'],
		'emergency',
		'#ef4444',
		'#fbbf24'
	];
	/** The label's colour: the alert's, or the normal one. */
	const LABEL_COLOUR: maplibregl.ExpressionSpecification = [
		'match',
		['get', 'tier'],
		'',
		'#f4f4f5',
		TIER_COLOUR
	];

	const reducedMotion = new MediaQuery('prefers-reduced-motion: reduce');

	/** The aircraft with alerts, as one string: the trail filter only changes when it does. */
	let alerting = $derived(
		[...new Set(activeAlerts(stream.aircraft, stream.now()).map((x) => x.icao))].sort().join(' ')
	);

	const toLngLat = (p: LatLon): LngLatLike => [p.lon, p.lat];
	const source = (m: maplibregl.Map, id: string) => m.getSource(id) as GeoJSONSource;
	const empty = { type: 'FeatureCollection' as const, features: [] };

	maplibregl.setWorkerUrl(workerUrl);

	/** How long the credits stay open on a narrow map: OSMF's guidelines allow five seconds. */
	const CREDITS_MS = 5000;

	function create(container: HTMLDivElement) {
		const center = untrack(() => receiver);
		const m = new maplibregl.Map({
			container,
			style: mapStyle(),
			center: toLngLat(center),
			zoom: 7,
			attributionControl: { compact: true },
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
		let creditsTimer: ReturnType<typeof setTimeout> | undefined;

		// Wind barbs: one image per speed (in 5 kt steps) and hemisphere, drawn on first use.
		m.on('styleimagemissing', (e) => {
			const barb = barbImage(e.id);
			if (barb && !m.hasImage(e.id))
				m.addImage(e.id, barb.image, { sdf: true, pixelRatio: barb.pixelRatio });
		});
		m.on('move', placeCard);

		m.on('load', () => {
			for (const { name, image, pixelRatio } of iconImages())
				m.addImage(name, image, { sdf: true, pixelRatio });

			for (const id of [
				'rings',
				'ring-labels',
				'route',
				'route-airports',
				'trails',
				'heads',
				'prediction',
				'prediction-minutes',
				'uncertainty',
				'alert-links',
				'aircraft',
				'receiver',
				'airport-selected',
				'winds',
				'coverage-outline',
				'coverage-horizon',
				'coverage-points',
				'coverage-sector',
				'radar-sites',
				'radar-ellipses',
				'radar-beams'
			])
				m.addSource(id, { type: 'geojson', data: empty });

			m.addLayer({
				id: 'rings',
				type: 'line',
				source: 'rings',
				paint: { 'line-color': '#52525b', 'line-width': 1, 'line-dasharray': [4, 4] }
			});
			m.addLayer({
				id: 'ring-labels',
				type: 'symbol',
				source: 'ring-labels',
				layout: {
					'text-field': ['get', 'label'],
					'text-font': FONT,
					'text-size': 10,
					'text-anchor': 'bottom',
					'text-offset': [0, -0.2]
				},
				paint: { 'text-color': '#71717a', 'text-halo-color': HALO, 'text-halo-width': 1.5 }
			});
			// Coverage: background, like the rings. The sector picked on the sky plot as a faint
			// wedge, the horizon dashed amber, the outlines in their band's colour.
			m.addLayer({
				id: 'coverage-sector',
				type: 'fill',
				source: 'coverage-sector',
				paint: { 'fill-color': '#f4f4f5', 'fill-opacity': 0.08 }
			});
			m.addLayer({
				id: 'coverage-horizon',
				type: 'line',
				source: 'coverage-horizon',
				filter: ['==', ['geometry-type'], 'LineString'],
				paint: {
					'line-color': HORIZON_COLOUR,
					'line-opacity': 0.6,
					'line-width': 1,
					'line-dasharray': [3, 2]
				}
			});
			m.addLayer({
				id: 'coverage-horizon-label',
				type: 'symbol',
				source: 'coverage-horizon',
				filter: ['==', ['geometry-type'], 'Point'],
				layout: {
					'text-field': ['get', 'label'],
					'text-font': FONT,
					'text-size': 10,
					'text-anchor': 'bottom',
					'text-offset': [0, -0.2]
				},
				paint: { 'text-color': HORIZON_COLOUR, 'text-halo-color': HALO, 'text-halo-width': 1.5 }
			});
			m.addLayer({
				id: 'coverage-fill',
				type: 'fill',
				source: 'coverage-outline',
				paint: { 'fill-color': altitudeColour(), 'fill-opacity': 0.05 }
			});
			m.addLayer({
				id: 'coverage-outline',
				type: 'line',
				source: 'coverage-outline',
				layout: { 'line-join': 'round' },
				paint: { 'line-color': altitudeColour(), 'line-width': 1, 'line-opacity': 0.6 }
			});
			m.addLayer({
				id: 'coverage-points',
				type: 'circle',
				source: 'coverage-points',
				paint: {
					'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 1, 9, 2.5],
					'circle-color': altitudeColour(),
					'circle-opacity': 0.5
				}
			});
			// Radars: the ellipses and beams faint, under the aircraft and their trails.
			m.addLayer({
				id: 'radar-ellipse-fill',
				type: 'fill',
				source: 'radar-ellipses',
				paint: {
					'fill-color': '#e4e4e7', // zinc-200
					'fill-opacity': ['case', ['get', 'selected'], 0.12, 0.05]
				}
			});
			m.addLayer({
				id: 'radar-ellipses',
				type: 'line',
				source: 'radar-ellipses',
				paint: {
					'line-color': '#d4d4d8', // zinc-300
					'line-width': ['case', ['get', 'selected'], 1.5, 1],
					'line-opacity': ['case', ['get', 'selected'], 0.8, 0.4],
					'line-dasharray': [2, 2]
				}
			});
			m.addLayer({
				id: 'radar-beams',
				type: 'line',
				source: 'radar-beams',
				layout: { 'line-cap': 'round' },
				paint: {
					'line-color': '#f4f4f5', // zinc-100
					'line-width': ['case', ['get', 'selected'], 2, 1],
					'line-opacity': ['*', ['get', 'opacity'], ['case', ['get', 'selected'], 0.55, 0.3]]
				}
			});
			// The route: under everything the aircraft draw, faint, so it reads as background.
			// Dash-dot, unlike the dashed range rings and the dotted predictions.
			m.addLayer({
				id: 'route',
				type: 'line',
				source: 'route',
				paint: {
					'line-color': '#a1a1aa', // zinc-400
					'line-width': 1.5,
					'line-opacity': 0.8,
					'line-dasharray': [6, 3, 1, 3]
				}
			});
			m.addLayer({
				id: 'route-airport-dots',
				type: 'circle',
				source: 'route-airports',
				paint: {
					'circle-radius': 3.5,
					'circle-color': '#a1a1aa',
					'circle-stroke-color': HALO,
					'circle-stroke-width': 1.5
				}
			});
			m.addLayer({
				id: 'route-airports',
				type: 'symbol',
				source: 'route-airports',
				layout: {
					'text-field': ['get', 'label'],
					'text-font': FONT,
					'text-size': 11,
					'text-anchor': 'bottom',
					'text-offset': [0, -0.5],
					'text-allow-overlap': true
				},
				paint: { 'text-color': '#e4e4e7', 'text-halo-color': HALO, 'text-halo-width': 2 }
			});
			for (const id of ['trails', 'heads'])
				m.addLayer({
					id,
					type: 'line',
					source: id,
					layout: { 'line-cap': 'round' },
					paint: {
						'line-color': altitudeColour(),
						// The selected aircraft's trail stands out (see the selection effect).
						'line-width': 1.5,
						'line-opacity': 0.7
					}
				});
			// Wind barbs: over the trails they were measured on, under everything else. They give
			// way to each other (the newest stays) and to the aircraft labels.
			m.addLayer({
				id: 'winds',
				type: 'symbol',
				source: 'winds',
				layout: {
					'icon-image': ['get', 'icon'],
					'icon-rotate': ['get', 'direction'],
					'icon-rotation-alignment': 'map',
					// Turned around the station (the dot), which sits on the point.
					'icon-anchor': 'bottom',
					'icon-offset': [0, BARB_BELOW / 2],
					'icon-size': 0.9,
					'icon-padding': 0,
					'symbol-sort-key': ['get', 'sort']
				},
				paint: {
					'icon-color': altitudeColour(),
					'icon-halo-color': HALO,
					'icon-halo-width': 1.5,
					'icon-opacity': ['get', 'opacity']
				}
			});
			// Uncertainty, to scale: the radii are pixels at zoom 0 (features.ts), doubling with
			// every zoom level. Accuracy filled, containment as a ring.
			const toScale = (key: string): maplibregl.ExpressionSpecification => [
				'interpolate',
				['exponential', 2],
				['zoom'],
				0,
				['get', key],
				24,
				['*', ['get', key], 2 ** 24]
			];
			m.addLayer({
				id: 'accuracy',
				type: 'circle',
				source: 'uncertainty',
				filter: ['has', 'accuracy'],
				paint: {
					'circle-radius': toScale('accuracy'),
					'circle-color': altitudeColour(),
					'circle-opacity': 0.15
				}
			});
			m.addLayer({
				id: 'containment',
				type: 'circle',
				source: 'uncertainty',
				filter: ['has', 'containment'],
				paint: {
					'circle-radius': toScale('containment'),
					'circle-color': 'rgba(0,0,0,0)',
					'circle-stroke-color': altitudeColour(),
					'circle-stroke-width': 1,
					'circle-stroke-opacity': 0.6
				}
			});
			// Neither accuracy nor integrity known: a fixed-size amber ring, a warning.
			m.addLayer({
				id: 'uncertainty-unknown',
				type: 'circle',
				source: 'uncertainty',
				filter: ['==', ['get', 'unknown'], true],
				paint: {
					'circle-radius': 13,
					'circle-color': 'rgba(0,0,0,0)',
					'circle-stroke-color': '#fbbf24', // amber-400
					'circle-stroke-width': 1.5,
					'circle-stroke-opacity': 0.8
				}
			});
			// Dots: zero-length dashes with round caps, a gap of 2.5 line widths between them.
			m.addLayer({
				id: 'prediction',
				type: 'line',
				source: 'prediction',
				layout: { 'line-cap': 'round' },
				paint: {
					'line-color': altitudeColour(),
					'line-width': 1.5,
					'line-opacity': 0.75,
					'line-dasharray': [0, 2.5]
				}
			});
			m.addLayer({
				id: 'prediction-minutes',
				type: 'symbol',
				source: 'prediction-minutes',
				layout: {
					'text-field': ['get', 'label'],
					'text-font': FONT,
					'text-size': 10,
					'text-anchor': 'left',
					'text-offset': [0.6, 0],
					'text-allow-overlap': true
				},
				paint: { 'text-color': '#a1a1aa', 'text-halo-color': HALO, 'text-halo-width': 1.5 }
			});
			m.addLayer({
				id: 'prediction-ticks',
				type: 'circle',
				source: 'prediction-minutes',
				paint: {
					'circle-radius': 2.5,
					'circle-color': '#f4f4f5',
					'circle-stroke-color': HALO,
					'circle-stroke-width': 1
				}
			});
			// The airport whose panel is open: a ring round its label (centred on the point;
			// 22 px clears a four-letter code).
			m.addLayer({
				id: 'airport-selected',
				type: 'circle',
				source: 'airport-selected',
				paint: {
					'circle-radius': 22,
					'circle-color': 'rgba(244,244,245,0.05)',
					'circle-stroke-color': '#f4f4f5',
					'circle-stroke-width': 1.5
				}
			});
			// The receiver; ringed like a selected aircraft while its panel is open.
			m.addLayer({
				id: 'receiver-selected',
				type: 'circle',
				source: 'receiver',
				layout: { visibility: 'none' },
				paint: {
					'circle-radius': 11,
					'circle-color': 'rgba(244,244,245,0.08)',
					'circle-stroke-color': '#f4f4f5',
					'circle-stroke-width': 1.5
				}
			});
			m.addLayer({
				id: 'receiver',
				type: 'circle',
				source: 'receiver',
				paint: {
					'circle-radius': 4,
					'circle-color': '#f4f4f5',
					'circle-stroke-color': HALO,
					'circle-stroke-width': 2
				}
			});
			// Radar sites: over the receiver, under the aircraft, whose labels go first. Radars
			// near each other (SI 1 and SI 28 near Bratislava, 20–30 km apart) would hide each
			// other's label at the bottom, so it may move to any side.
			m.addLayer({
				id: 'radar-sites',
				type: 'symbol',
				source: 'radar-sites',
				layout: {
					'icon-image': 'radar',
					'icon-size': ['case', ['get', 'selected'], 0.6, 0.45],
					'icon-allow-overlap': true,
					'icon-ignore-placement': true,
					'text-field': ['step', ['zoom'], '', 5, ['get', 'label']],
					'text-font': FONT,
					'text-size': 10,
					'text-variable-anchor': ['top', 'bottom', 'right', 'left'],
					'text-radial-offset': 1.1,
					'text-optional': true
				},
				paint: {
					'icon-color': '#e4e4e7', // zinc-200
					'icon-halo-color': HALO,
					'icon-halo-width': 2,
					// Not heard for a while: dimmer (and no beam).
					'icon-opacity': ['case', ['get', 'heard'], 1, 0.5],
					'text-color': '#a1a1aa', // zinc-400
					'text-halo-color': HALO,
					'text-halo-width': 1.5
				}
			});
			// ACAS advisories: the two aircraft joined by a line, with how far apart vertically.
			m.addLayer({
				id: 'alert-links',
				type: 'line',
				source: 'alert-links',
				paint: { 'line-color': TIER_COLOUR, 'line-width': 2, 'line-dasharray': [2, 1.5] }
			});
			m.addLayer({
				id: 'alert-link-labels',
				type: 'symbol',
				source: 'alert-links',
				layout: {
					'symbol-placement': 'line-center',
					'text-field': ['get', 'label'],
					'text-font': FONT,
					'text-size': 11,
					'text-offset': [0, -0.8],
					'text-allow-overlap': true
				},
				paint: { 'text-color': TIER_COLOUR, 'text-halo-color': HALO, 'text-halo-width': 2 }
			});
			// When an alert starts: rings pulsing out from the symbol (features.ts PULSES).
			m.addLayer({
				id: 'alert-pulse',
				type: 'circle',
				source: 'aircraft',
				filter: ['>=', ['get', 'pulse'], 0],
				paint: {
					'circle-radius': ['+', 18, ['*', 40, ['get', 'pulse']]],
					'circle-color': 'rgba(0,0,0,0)',
					'circle-stroke-color': TIER_COLOUR,
					'circle-stroke-width': 2,
					'circle-stroke-opacity': ['-', 1, ['get', 'pulse']]
				}
			});
			// Larger and bolder than the amber "integrity unknown" ring (13 px, thin), and
			// outside the selection ring (17 px), so all three can be told apart.
			m.addLayer({
				id: 'alert-ring',
				type: 'circle',
				source: 'aircraft',
				filter: ['!=', ['get', 'tier'], ''],
				paint: {
					'circle-radius': 21,
					'circle-color': TIER_COLOUR,
					'circle-opacity': 0.12,
					'circle-stroke-color': TIER_COLOUR,
					'circle-stroke-width': 2.5
				}
			});
			m.addLayer({
				id: 'selected',
				type: 'circle',
				source: 'aircraft',
				filter: ['==', ['get', 'icao'], ''],
				paint: {
					'circle-radius': 17,
					'circle-color': 'rgba(244,244,245,0.08)',
					'circle-stroke-color': '#f4f4f5',
					'circle-stroke-width': 1.5
				}
			});
			m.addLayer({
				id: 'aircraft',
				type: 'symbol',
				source: 'aircraft',
				layout: {
					'icon-image': ['get', 'icon'],
					'icon-size': ['get', 'size'],
					'icon-rotate': ['get', 'track'],
					// Rotated relative to north on the map, not to the screen.
					'icon-rotation-alignment': 'map',
					'icon-allow-overlap': true,
					'icon-ignore-placement': true,
					// Labels only when zoomed in enough to have room; they give way to each other.
					// An alert's badge goes above, at any zoom, and alerts are placed first.
					'text-field': [
						'step',
						['zoom'],
						['get', 'badge'],
						7,
						[
							'format',
							['case', ['==', ['get', 'badge'], ''], '', ['concat', ['get', 'badge'], '\n']],
							{ 'text-color': LABEL_COLOUR },
							['get', 'label'],
							{}
						]
					],
					'symbol-sort-key': ['get', 'sort'],
					'text-font': FONT,
					'text-size': 10,
					'text-anchor': 'top',
					// Below the symbol; with a badge, below the alert ring too.
					'text-offset': [
						'case',
						['==', ['get', 'badge'], ''],
						['literal', [0, 1.3]],
						['literal', [0, 2.3]]
					],
					'text-optional': true
				},
				paint: {
					'icon-color': altitudeColour(),
					'icon-halo-color': HALO,
					'icon-halo-width': 2,
					// (Set again while a radar is open: see `answered`.)
					'icon-opacity': ['case', ['get', 'dim'], 0.15, ['get', 'stale'], STALE_OPACITY, 1],
					// The badge alone (zoomed out) in the alert's colour; with the label, the
					// format above colours the badge.
					'text-color': ['step', ['zoom'], LABEL_COLOUR, 7, '#d4d4d8'],
					'text-halo-color': HALO,
					'text-halo-width': 1.5,
					'text-opacity': ['case', ['get', 'stale'], STALE_OPACITY, 1]
				}
			});

			m.on('click', (e: MapMouseEvent) => {
				// Generous hit box: the symbols are small, fingers are not.
				const box: [maplibregl.PointLike, maplibregl.PointLike] = [
					[e.point.x - 12, e.point.y - 12],
					[e.point.x + 12, e.point.y + 12]
				];
				// The aircraft, radar or receiver nearest the tap: an aircraft passing over the
				// receiver mustn't make the dot impossible to hit, nor the other way round. Then a
				// wind barb (they sit under the aircraft's trails), then an airport's label.
				const query = (id: string) => m.queryRenderedFeatures(box, { layers: [id] });
				const away = (f: maplibregl.MapGeoJSONFeature) => {
					if (f.geometry.type !== 'Point') return Infinity;
					const at = m.project(f.geometry.coordinates as [number, number]);
					return Math.hypot(at.x - e.point.x, at.y - e.point.y);
				};
				const nearest = [
					...query('aircraft').map((f) => ({ f, kind: 'aircraft' as const })),
					...(layers.radars ? query('radar-sites') : []).map((f) => ({
						f,
						kind: 'radar' as const
					})),
					...query('receiver').map((f) => ({ f, kind: 'receiver' as const }))
				].sort((a, b) => away(a.f) - away(b.f))[0];
				if (nearest) {
					picked = null;
					if (nearest.kind === 'aircraft') stream.select(nearest.f.properties.icao as string);
					else if (nearest.kind === 'radar')
						onfocus({ kind: 'radar', id: nearest.f.properties.id as string });
					else onfocus({ kind: 'receiver' });
					return;
				}
				const barb = layers.winds ? (query('winds')[0] ?? null) : null;
				if (barb && barb.geometry.type === 'Point') {
					const [lon, lat] = barb.geometry.coordinates;
					picked = { barb: barb.properties as BarbProperties, lon, lat };
					placeCard();
					return;
				}
				const label = query('airports')[0];
				const airport =
					label?.geometry.type === 'Point'
						? airportFrom(label.properties, {
								lon: label.geometry.coordinates[0],
								lat: label.geometry.coordinates[1]
							})
						: null;
				if (airport) {
					picked = null;
					onfocus({ kind: 'airport', airport });
					return;
				}
				picked = null;
				stream.select(null);
				onfocus(null);
			});
			for (const id of ['aircraft', 'winds', 'receiver', 'radar-sites', 'airports']) {
				m.on('mouseenter', id, () => (m.getCanvas().style.cursor = 'pointer'));
				m.on('mouseleave', id, () => (m.getCanvas().style.cursor = ''));
			}

			// The credits open expanded. On a narrow map they cover the legend and the layers, so
			// there they fold to the ⓘ on the first tap or zoom (MapLibre itself only on a drag),
			// or after CREDITS_MS. Never before they've been seen: OSMF's attribution guidelines
			// want them visible without a tap at first, and allow folding them on map interaction
			// or after five seconds. Opened again with the ⓘ, the next tap or zoom folds them.
			if (container.clientWidth < 800) {
				const credits = container.querySelector('.maplibregl-ctrl-attrib');
				const fold = () => {
					credits?.classList.remove('maplibregl-compact-show');
					credits?.removeAttribute('open');
				};
				m.on('click', fold);
				// Only the user's zooms (they carry the input event), not the fit to the first aircraft.
				m.on('zoomstart', (e) => e.originalEvent && fold());
				creditsTimer = setTimeout(fold, CREDITS_MS);
			}

			map = m;
		});

		return () => {
			clearTimeout(creditsTimer);
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
			geometry: { type: 'Point', coordinates: [receiver.lon, receiver.lat] }
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
	// The panel's extras: the positions behind the outlines, and the sector picked on its plot.
	$effect(() => {
		const open = focus?.kind === 'receiver';
		if (!map) return;
		source(map, 'coverage-points').setData(open ? pointFeatures(coverage.points) : empty);
		source(map, 'coverage-sector').setData(
			open && sector !== null
				? sectorFeature(receiver, sector * SECTOR_DEG, radioHorizon(HORIZON_FT))
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
						geometry: { type: 'Point', coordinates: [airport.lon, airport.lat] }
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
			if (radar && !m.getBounds().contains(toLngLat(radar.position)))
				m.easeTo({ center: toLngLat(radar.position) });
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
		const normal: maplibregl.ExpressionSpecification = [
			'case',
			['get', 'dim'],
			0.15,
			['get', 'stale'],
			STALE_OPACITY,
			1
		];
		map.setPaintProperty(
			'aircraft',
			'icon-opacity',
			icaos ? ['case', ['in', ['get', 'icao'], ['literal', icaos]], normal, 0.25] : normal
		);
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

	/** Put the card over its barb (on tap, and as the map moves). */
	function placeCard() {
		if (!map || !picked) return;
		const { x, y } = map.project([picked.lon, picked.lat]);
		pickedAt = { x, y, width: map.getContainer().clientWidth };
	}
	// The barb switched off: no card for it.
	$effect(() => {
		if (!layers.winds) picked = null;
	});

	/** Who measured the picked barb: callsign if known, else the address. */
	let pickedBy = $derived.by(() => {
		if (!picked) return null;
		const icao = picked.barb.icao;
		const tracked = stream.get(icao);
		const callsign =
			tracked?.callsign?.value ?? weather.aircraft.find((a) => a.icao === icao)?.callsign ?? null;
		return { icao, name: callsign ?? icao, tracked: !!tracked };
	});

	// Trails: with every update from the tracker.
	$effect(() => {
		const list = stream.aircraft;
		if (!map) return;
		source(map, 'trails').setData(trailFeatures(list, stream.now()));
	});

	// Aircraft and the trail pieces up to them: every animation frame (throttled).
	$effect(() => {
		const m = map;
		if (!m) return;
		let frame = 0;
		let last = 0;
		const draw = (time: number) => {
			frame = requestAnimationFrame(draw);
			if (time - last < FRAME_MS) return;
			last = time;
			const list = stream.aircraft;
			const now = stream.now();
			source(m, 'aircraft').setData(aircraftFeatures(list, now, !reducedMotion.current));
			source(m, 'alert-links').setData(alertLinkFeatures(list, now));
			source(m, 'heads').setData(headFeatures(list, now));
			const prediction = predictionFeatures(list, now, stream.selected);
			source(m, 'prediction').setData(prediction.lines);
			source(m, 'prediction-minutes').setData(prediction.minutes);
			source(m, 'uncertainty').setData(uncertaintyFeatures(list, now));
			// The beams sweep: none for those who asked for less motion.
			const sweep = layers.radars && !reducedMotion.current;
			source(m, 'radar-beams').setData(sweep ? beamFeatures(radars.radars, openRadar, now) : empty);
		};
		frame = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(frame);
	});

	// The switches: show or hide their layers (the data keeps flowing; it's cheap).
	$effect(() => {
		const m = map;
		if (!m) return;
		for (const [key, ids] of Object.entries(LAYER_IDS)) {
			const on = key === 'coverage' ? coverageShown : layers[key as keyof Layers];
			for (const id of ids) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
		}
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
		for (const id of ['trails', 'heads']) {
			map.setFilter(id, layers.trail ? null : kept);
			map.setPaintProperty(id, 'line-width', ['case', mine, 3, 1.5]);
			map.setPaintProperty(id, 'line-opacity', ['case', mine, 1, icao ? 0.35 : 0.7]);
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
			if (p && !m.getBounds().contains(toLngLat(p))) m.easeTo({ center: toLngLat(p) });
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
		for (const p of [...points, receiver]) bounds.extend(toLngLat(p));
		m.fitBounds(bounds, { padding: 60, maxZoom: 8, duration: 0 });
	});
</script>

<!-- MapLibre makes its container `position: relative` (unlayered CSS, so it beats Tailwind's
     `absolute`): the positioning goes on a wrapper. -->
<div class="absolute inset-0">
	<div class="h-full w-full" {@attach create}></div>

	{#if picked && pickedAt && pickedBy}
		{@const b = picked.barb}
		{@const age = Math.max(0, Math.round((weather.now - b.rx) / 60_000))}
		<!-- Above the barb, kept inside the map sideways. -->
		<div
			class="absolute z-10 w-64 -translate-y-full rounded-md bg-zinc-950/95 px-3 py-2 text-xs text-zinc-300 shadow-lg ring-1 ring-zinc-800"
			style:left="{Math.min(Math.max(pickedAt.x - 128, 8), pickedAt.width - 264)}px"
			style:top="{pickedAt.y - 12}px"
			role="dialog"
			aria-label="Wind barb"
		>
			<div class="flex items-start justify-between gap-2">
				<p class="text-sm font-semibold text-zinc-100 tabular-nums">
					{compass(b.direction)}
					{degrees(b.direction)} · {Math.round(b.speed)} kt
					<span class="font-normal text-zinc-400">at {flightLevel(b.altitude)}</span>
				</p>
				<button
					type="button"
					onclick={() => (picked = null)}
					class="-mt-0.5 -mr-1 rounded px-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
					aria-label="Close">✕</button
				>
			</div>
			<p class="mt-1">
				Measured by
				{#if pickedBy.tracked}
					<button
						type="button"
						class="font-mono text-zinc-100 underline decoration-zinc-600 underline-offset-2 hover:decoration-zinc-300"
						onclick={() => {
							stream.select(pickedBy.icao);
							picked = null;
						}}>{pickedBy.name}</button
					>
				{:else}
					<span class="font-mono text-zinc-100">{pickedBy.name}</span> (gone){/if}
				{age < 1 ? 'in the last minute' : `${age} min ago`}, here.
			</p>
			<p class="mt-1 text-zinc-400">
				{#if b.from === 'turn'}
					From a turn: its ground speed and track all the way round trace a circle whose centre is
					the wind.
				{:else}
					{b.samples === 1 ? 'From one reading' : `Mean of ${b.samples} readings`}: its ground
					vector minus its air vector (registers 5,0 and 6,0).{#if b.corrected}
						Its heading was turned {Math.abs(b.corrected).toFixed(1)}° first: the other aircraft's
						winds say it's off (at least {MIN_CORRECTION}°).{/if}
				{/if}
				The staff points where the wind comes from.
			</p>
		</div>
	{/if}
</div>
