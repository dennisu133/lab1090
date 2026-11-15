<!--
	The radar experiment's map: the radars the finder confirmed (lib/radar/finder.ts), with
	their uncertainty ellipses and their beams sweeping round as the fit predicts
	(lib/map/radars.ts), over the aircraft whose replies placed them and the receiver's range
	rings. Zoomed out further than the tracker: the radars stand 200–500 km away.

	Its own map, not a layer on the tracker's: the method is an experiment, and a live run
	on the dev server showed it can still be wrong (ROADMAP.md, phase 4).

	Tap a radar for the panel that explains how it was found; tap the map elsewhere to close
	it. With a radar selected, the aircraft that answered it stand out.
-->
<script lang="ts">
	import * as maplibregl from 'maplibre-gl';
	import type { GeoJSONSource, LngLatLike, MapMouseEvent } from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	// MapLibre's worker, as in TrackerMap.svelte.
	import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
	import { untrack } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import type { LatLon } from '#lib/modes/cpr.ts';
	import { altitudeColour } from '#lib/map/altitude.ts';
	import { aircraftFeatures, ringFeatures, type Unit } from '#lib/map/features.ts';
	import { iconImages } from '#lib/map/icons.ts';
	import { beamFeatures, radarFeatures } from '#lib/map/radars.ts';
	import { mapStyle } from '#lib/map/style.ts';
	import type { TrackerStream } from '../../tracker-stream.svelte';
	import type { RadarStream } from './radar-stream.svelte';

	interface Props {
		stream: RadarStream;
		/** The aircraft, from the tracker. */
		tracker: TrackerStream;
		receiver: LatLon | null;
		unit: Unit;
	}

	let { stream, tracker, receiver, unit }: Props = $props();

	/** Set once the style has loaded and our sources and layers exist. */
	let map = $state<maplibregl.Map | null>(null);

	/** Redraw the beams and aircraft at most this often. */
	const FRAME_MS = 50;
	/** Redraw the sites at least this often: one no longer heard dims. */
	const SITES_MS = 10_000;
	const FONT = ['Noto Sans Regular'];
	const HALO = '#09090b';

	const reducedMotion = new MediaQuery('prefers-reduced-motion: reduce');

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
			zoom: 5,
			attributionControl: { compact: true },
			dragRotate: false,
			pitchWithRotate: false,
			touchPitch: false,
			fadeDuration: 0
		});
		m.touchZoomRotate.disableRotation();

		m.on('load', () => {
			for (const { name, image, pixelRatio } of iconImages())
				m.addImage(name, image, { sdf: true, pixelRatio });

			for (const id of [
				'rings',
				'ring-labels',
				'receiver',
				'aircraft',
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
			// The ellipses and beams under the aircraft, faint; the sites on top.
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
				id: 'aircraft',
				type: 'symbol',
				source: 'aircraft',
				layout: {
					'icon-image': ['get', 'icon'],
					'icon-size': ['get', 'size'],
					'icon-rotate': ['get', 'track'],
					'icon-rotation-alignment': 'map',
					'icon-allow-overlap': true,
					'icon-ignore-placement': true,
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
					'text-halo-width': 1.5
				}
			});
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
					'text-anchor': 'top',
					'text-offset': [0, 1.1],
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

			m.on('click', (e: MapMouseEvent) => {
				// Generous hit box: the symbols are small, fingers are not.
				const box: [maplibregl.PointLike, maplibregl.PointLike] = [
					[e.point.x - 12, e.point.y - 12],
					[e.point.x + 12, e.point.y + 12]
				];
				const hit = m.queryRenderedFeatures(box, { layers: ['radar-sites'] })[0];
				stream.select(hit ? (hit.properties.id as string) : null);
			});
			m.on('mouseenter', 'radar-sites', () => (m.getCanvas().style.cursor = 'pointer'));
			m.on('mouseleave', 'radar-sites', () => (m.getCanvas().style.cursor = ''));

			// The credits open expanded; on a narrow map they'd cover the map's corner.
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

	// Radar sites and ellipses: when one is confirmed, refitted or dropped, the selection
	// changes, and every SITES_MS (a radar no longer heard dims).
	let clock = $state(0);
	$effect(() => {
		const timer = setInterval(() => (clock = Date.now()), SITES_MS);
		return () => clearInterval(timer);
	});
	$effect(() => {
		void clock;
		const radars = stream.radars;
		const selected = stream.selected;
		if (!map) return;
		const { sites, ellipses } = radarFeatures(
			radars,
			selected,
			untrack(() => stream.now())
		);
		source(map, 'radar-sites').setData(sites);
		source(map, 'radar-ellipses').setData(ellipses);
	});

	// A radar selected (from the list) but off screen: bring it into view. Only when the
	// selection changes, not with every refit (the map would keep pulling back to it).
	$effect(() => {
		const id = stream.selected;
		const m = map;
		if (!m || !id) return;
		untrack(() => {
			const radar = stream.get(id);
			if (radar && !m.getBounds().contains(toLngLat(radar.position)))
				m.easeTo({ center: toLngLat(radar.position) });
		});
	});

	// With a radar selected, the aircraft that answered it stand out.
	$effect(() => {
		const radar = stream.get(stream.selected);
		if (!map) return;
		const answered = radar?.aircraft.filter((a) => a.explained > 0).map((a) => a.icao) ?? [];
		map.setPaintProperty(
			'aircraft',
			'icon-opacity',
			radar
				? ['case', ['in', ['get', 'icao'], ['literal', answered]], 1, 0.25]
				: ['case', ['get', 'stale'], 0.45, 1]
		);
	});

	// Aircraft and beams: every animation frame (throttled). The beams sweep: none for
	// those who asked for less motion.
	$effect(() => {
		const m = map;
		if (!m) return;
		let frame = 0;
		let last = 0;
		const draw = (time: number) => {
			frame = requestAnimationFrame(draw);
			if (time - last < FRAME_MS) return;
			last = time;
			const now = tracker.now();
			source(m, 'aircraft').setData(aircraftFeatures(tracker.aircraft, now, false));
			source(m, 'radar-beams').setData(
				reducedMotion.current ? empty : beamFeatures(stream.radars, stream.selected, now)
			);
		};
		frame = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(frame);
	});
</script>

<!-- MapLibre makes its container `position: relative` (unlayered CSS, so it beats Tailwind's
     `absolute`): the positioning goes on a wrapper. -->
<div class="absolute inset-0">
	<div class="h-full w-full" {@attach create}></div>
</div>
