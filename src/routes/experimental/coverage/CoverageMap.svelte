<!--
	The coverage experiment's map (lib/map/coverage.ts): an outline per altitude band out to
	the farthest position heard there in each direction, the radio horizon at FL350 for
	comparison (where the top band's outline would reach over a smooth Earth with nothing in the
	way), the positions as dots, and the sector picked on the sky plot as a wedge.

	Its own map, like the radars': an experiment, kept off the tracker.
-->
<script lang="ts">
	import * as maplibregl from 'maplibre-gl';
	import type { GeoJSONSource, LngLatLike } from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	// MapLibre's worker, as in TrackerMap.svelte.
	import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
	import { untrack } from 'svelte';
	import { SECTOR_DEG } from '#lib/coverage/coverage.ts';
	import { radioHorizon } from '#lib/coverage/geometry.ts';
	import type { LatLon } from '#lib/modes/cpr.ts';
	import { altitudeColour } from '#lib/map/altitude.ts';
	import {
		HORIZON_FT,
		horizonFeatures,
		outlineFeatures,
		pointFeatures,
		sectorFeature
	} from '#lib/map/coverage.ts';
	import { ringFeatures, type Unit } from '#lib/map/features.ts';
	import { mapStyle } from '#lib/map/style.ts';
	import type { CoverageStream } from './coverage-stream.svelte';

	interface Props {
		stream: CoverageStream;
		receiver: LatLon;
		unit: Unit;
		/** The sector picked on the sky plot; null: none. */
		selected: number | null;
	}

	let { stream, receiver, unit, selected }: Props = $props();

	let map = $state<maplibregl.Map | null>(null);

	const FONT = ['Noto Sans Regular'];
	const HALO = '#09090b';
	const toLngLat = (p: LatLon): LngLatLike => [p.lon, p.lat];
	const source = (m: maplibregl.Map, id: string) => m.getSource(id) as GeoJSONSource;
	const empty = { type: 'FeatureCollection' as const, features: [] };

	maplibregl.setWorkerUrl(workerUrl);

	function create(container: HTMLDivElement) {
		const m = new maplibregl.Map({
			container,
			style: mapStyle(),
			center: toLngLat(untrack(() => receiver)),
			zoom: 5.5,
			attributionControl: { compact: true },
			dragRotate: false,
			pitchWithRotate: false,
			touchPitch: false,
			fadeDuration: 0
		});
		m.touchZoomRotate.disableRotation();

		m.on('load', () => {
			for (const id of [
				'rings',
				'ring-labels',
				'receiver',
				'horizon',
				'outline',
				'points',
				'sector'
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
			m.addLayer({
				id: 'sector',
				type: 'fill',
				source: 'sector',
				paint: { 'fill-color': '#f4f4f5', 'fill-opacity': 0.08 }
			});
			m.addLayer({
				id: 'horizon',
				type: 'line',
				source: 'horizon',
				filter: ['==', ['geometry-type'], 'LineString'],
				paint: {
					'line-color': '#fcd34d',
					'line-opacity': 0.6,
					'line-width': 1,
					'line-dasharray': [3, 2]
				}
			});
			m.addLayer({
				id: 'horizon-label',
				type: 'symbol',
				source: 'horizon',
				filter: ['==', ['geometry-type'], 'Point'],
				layout: {
					'text-field': ['get', 'label'],
					'text-font': FONT,
					'text-size': 10,
					'text-anchor': 'bottom',
					'text-offset': [0, -0.2]
				},
				paint: { 'text-color': '#fcd34d', 'text-halo-color': HALO, 'text-halo-width': 1.5 }
			});
			m.addLayer({
				id: 'points',
				type: 'circle',
				source: 'points',
				paint: {
					'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 1, 9, 2.5],
					'circle-color': altitudeColour(),
					'circle-opacity': 0.6
				}
			});
			m.addLayer({
				id: 'outline',
				type: 'line',
				source: 'outline',
				layout: { 'line-join': 'round' },
				paint: { 'line-color': altitudeColour(), 'line-width': 1.5 }
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

	// The receiver, rings and horizon: when the unit or the antenna height changes.
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
		source(map, 'horizon').setData(
			horizonFeatures(receiver, HORIZON_FT, stream.terrain?.antennaKm ?? 0)
		);
	});

	$effect(() => {
		if (map) source(map, 'outline').setData(outlineFeatures(stream.sectors, receiver));
	});

	$effect(() => {
		if (map) source(map, 'points').setData(pointFeatures(stream.points));
	});

	$effect(() => {
		if (!map) return;
		source(map, 'sector').setData(
			selected === null
				? empty
				: sectorFeature(receiver, selected * SECTOR_DEG, radioHorizon(HORIZON_FT))
		);
	});
</script>

<!-- MapLibre makes its container `position: relative` (unlayered CSS, so it beats Tailwind's
     `absolute`): the positioning goes on a wrapper. -->
<div class="absolute inset-0">
	<div class="h-full w-full" {@attach create}></div>
</div>
