<!--
	The spot about to be saved, on the app's base map: zoomed in far enough to see the
	building, or out to the whole match when the search only found a street or an area (its
	bounding box), so you can see how much it covers.
-->
<script lang="ts">
	import * as maplibregl from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
	import type { LatLon } from '#lib/modes/cpr.ts';
	import { mapStyle } from '#lib/map/style.ts';

	interface Props {
		position: LatLon;
		/** South, north, west, east: the search match's extent, if any. */
		bounds?: [number, number, number, number];
	}

	let { position, bounds }: Props = $props();

	maplibregl.setWorkerUrl(workerUrl);

	let map = $state<maplibregl.Map>();
	let marker: maplibregl.Marker | undefined;

	function create(container: HTMLDivElement) {
		const m = new maplibregl.Map({
			container,
			style: mapStyle({ streets: true }),
			center: [position.lon, position.lat],
			zoom: 16,
			attributionControl: { compact: true },
			dragRotate: false,
			pitchWithRotate: false,
			touchPitch: false
		});
		m.touchZoomRotate.disableRotation();
		marker = new maplibregl.Marker({ color: '#f4f4f5' }).setLngLat([position.lon, position.lat]);
		marker.addTo(m);
		map = m;
		return () => {
			m.remove();
			map = undefined;
		};
	}

	// A new spot: move the marker, show it (and the match's extent).
	$effect(() => {
		if (!map || !marker) return;
		marker.setLngLat([position.lon, position.lat]);
		if (bounds) {
			const [south, north, west, east] = bounds;
			map.fitBounds(
				[
					[west, south],
					[east, north]
				],
				{ padding: 40, maxZoom: 17, duration: 0 }
			);
		} else {
			map.jumpTo({ center: [position.lon, position.lat], zoom: 16 });
		}
	});
</script>

<div
	{@attach create}
	class="h-72 w-full overflow-hidden rounded-lg border border-zinc-800 sm:h-80"
></div>
