<!--
	The map: base map (lib/map/style.ts), range rings around the receiver, trails, aircraft
	the dotted predicted paths ahead of them and the circles of their position uncertainty
	(either can be switched off: MapLayers.svelte). MapLibre draws with WebGL from GeoJSON
	sources; this component keeps those sources up to date with the tracker. Aircraft, the
	pieces of trail up to them and the predictions move every animation frame (dead
	reckoning, lib/map/features.ts); trails only change with new positions.

	Tap or click an aircraft to select it; tap the map elsewhere to deselect.
-->
<script lang="ts">
	import * as maplibregl from 'maplibre-gl';
	import type { GeoJSONSource, LngLatLike, MapMouseEvent } from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	// MapLibre parses tiles in a web worker, which it looks for next to its own file. Vite
	// bundles the library elsewhere, so tell it where the worker is (`?url`: Vite serves the
	// file as is in dev and copies it into the build).
	import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
	import { untrack } from 'svelte';
	import type { LatLon } from '#lib/modes/cpr.ts';
	import { altitudeColour } from '#lib/map/altitude.ts';
	import {
		aircraftFeatures,
		headFeatures,
		predictionFeatures,
		ringFeatures,
		shownPosition,
		trailFeatures,
		uncertaintyFeatures,
		type Unit
	} from '#lib/map/features.ts';
	import { iconImages } from '#lib/map/icons.ts';
	import { mapStyle } from '#lib/map/style.ts';
	import type { Layers } from './MapLayers.svelte';
	import type { TrackerStream } from './tracker-stream.svelte.ts';

	interface Props {
		stream: TrackerStream;
		receiver: LatLon | null;
		unit: Unit;
		layers: Layers;
	}

	let { stream, receiver, unit, layers }: Props = $props();

	/** The map layers each switch shows or hides. */
	const LAYER_IDS: Record<keyof Layers, string[]> = {
		prediction: ['prediction', 'prediction-ticks', 'prediction-minutes'],
		uncertainty: ['accuracy', 'containment', 'uncertainty-unknown']
	};

	/** Set once the style has loaded and our sources and layers exist. */
	let map = $state<maplibregl.Map | null>(null);

	/** Redraw moving aircraft at most this often: smooth enough, and cheap. */
	const FRAME_MS = 50;
	const FONT = ['Noto Sans Regular'];
	const HALO = '#09090b';

	const toLngLat = (p: LatLon): LngLatLike => [p.lon, p.lat];
	const source = (m: maplibregl.Map, id: string) => m.getSource(id) as GeoJSONSource;
	const empty = { type: 'FeatureCollection' as const, features: [] };

	maplibregl.setWorkerUrl(workerUrl);

	function create(container: HTMLDivElement) {
		const center = untrack(() => receiver);
		const m = new maplibregl.Map({
			container,
			style: mapStyle(),
			center: center ? toLngLat(center) : [10.5, 51.2], // else: the middle of Germany
			zoom: center ? 7 : 5,
			attributionControl: { compact: true },
			// Rotating the map would make "north up" and the tracks confusing; pinch-zoom stays.
			dragRotate: false,
			pitchWithRotate: false,
			touchPitch: false
		});
		m.touchZoomRotate.disableRotation();

		m.on('load', () => {
			for (const { name, image, pixelRatio } of iconImages())
				m.addImage(name, image, { sdf: true, pixelRatio });

			for (const id of [
				'rings',
				'ring-labels',
				'trails',
				'heads',
				'prediction',
				'prediction-minutes',
				'uncertainty',
				'aircraft',
				'receiver'
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
					'text-field': ['step', ['zoom'], '', 7, ['get', 'label']],
					'text-font': FONT,
					'text-size': 10,
					'text-anchor': 'top',
					'text-offset': [0, 1.3],
					'text-optional': true
				},
				paint: {
					'icon-color': altitudeColour(),
					'icon-halo-color': HALO,
					'icon-halo-width': 2,
					'icon-opacity': ['case', ['get', 'stale'], 0.45, 1],
					'text-color': '#d4d4d8',
					'text-halo-color': HALO,
					'text-halo-width': 1.5,
					'text-opacity': ['case', ['get', 'stale'], 0.45, 1]
				}
			});

			m.on('click', (e: MapMouseEvent) => {
				// Generous hit box: the symbols are small, fingers are not.
				const box: [maplibregl.PointLike, maplibregl.PointLike] = [
					[e.point.x - 12, e.point.y - 12],
					[e.point.x + 12, e.point.y + 12]
				];
				const hit = m.queryRenderedFeatures(box, { layers: ['aircraft'] })[0];
				stream.select(hit ? (hit.properties.icao as string) : null);
			});
			m.on('mouseenter', 'aircraft', () => (m.getCanvas().style.cursor = 'pointer'));
			m.on('mouseleave', 'aircraft', () => (m.getCanvas().style.cursor = ''));

			// The credits open expanded; on a narrow map they'd cover the legend. Collapsed,
			// they're one tap on the ⓘ away.
			if (container.clientWidth < 800) {
				const credits = container.querySelector('.maplibregl-ctrl-attrib');
				credits?.classList.remove('maplibregl-compact-show');
				credits?.removeAttribute('open');
			}

			map = m;
		});

		return () => {
			map = null;
			m.remove();
		};
	}

	// The receiver and the range rings: when the unit changes.
	$effect(() => {
		if (!map || !receiver) return;
		const { rings, labels } = ringFeatures(receiver, unit);
		source(map, 'rings').setData(rings);
		source(map, 'ring-labels').setData(labels);
		source(map, 'receiver').setData({
			type: 'Feature',
			properties: {},
			geometry: { type: 'Point', coordinates: [receiver.lon, receiver.lat] }
		});
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
			source(m, 'aircraft').setData(aircraftFeatures(list, now));
			source(m, 'heads').setData(headFeatures(list, now));
			const prediction = predictionFeatures(list, now, stream.selected);
			source(m, 'prediction').setData(prediction.lines);
			source(m, 'prediction-minutes').setData(prediction.minutes);
			source(m, 'uncertainty').setData(uncertaintyFeatures(list, now));
		};
		frame = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(frame);
	});

	// The switches: show or hide their layers (the data keeps flowing; it's cheap).
	$effect(() => {
		const m = map;
		if (!m) return;
		for (const [key, ids] of Object.entries(LAYER_IDS))
			for (const id of ids)
				m.setLayoutProperty(id, 'visibility', layers[key as keyof Layers] ? 'visible' : 'none');
	});

	// The selection: a ring around the symbol, its trail brighter and wider.
	$effect(() => {
		const icao = stream.selected ?? '';
		if (!map) return;
		map.setFilter('selected', ['==', ['get', 'icao'], icao]);
		const mine = ['==', ['get', 'icao'], icao] as maplibregl.ExpressionSpecification;
		for (const id of ['trails', 'heads']) {
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
		for (const p of [...points, ...(receiver ? [receiver] : [])]) bounds.extend(toLngLat(p));
		m.fitBounds(bounds, { padding: 60, maxZoom: 8, duration: 0 });
	});
</script>

<!-- MapLibre makes its container `position: relative` (unlayered CSS, so it beats Tailwind's
     `absolute`): the positioning goes on a wrapper. -->
<div class="absolute inset-0">
	<div class="h-full w-full" {@attach create}></div>
</div>
