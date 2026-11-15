/**
 * The base map: dark, quiet, in the app's zinc greys, so the coloured aircraft stand out.
 * Our own style rather than a ready-made one: a dozen layers instead of fifty, and only
 * what helps to read air traffic: water and forests to recognise the area, borders, the
 * big roads, place names, and airports with their runways and ICAO codes.
 *
 * Two free sources, no API key:
 * - OpenFreeMap: vector tiles of OpenStreetMap data, in the OpenMapTiles schema (layer and
 *   field names: https://openmaptiles.org/schema/). Vector tiles carry the shapes, not the
 *   colours: the colours below are applied in the browser.
 * - Terrain Tiles on AWS (Mapzen's "terrarium" format): elevation as PNG, metres encoded in
 *   the colour (height = R·256 + G + B/256 − 32768). MapLibre turns it into hillshading:
 *   light from the north-west, shadows on the far side, like a relief map.
 */
import type { StyleSpecification } from 'maplibre-gl';

const FONT = ['Noto Sans Regular'];

/** Tailwind's zinc, plus a dark blue-grey for water. */
const C = {
	land: '#131316',
	water: '#0d1520',
	waterway: '#14202e',
	wood: '#17181b',
	residential: '#1a1a1e',
	border: '#52525b', // zinc-600
	state: '#3f3f46', // zinc-700
	motorway: '#3f3f46',
	road: '#27272a', // zinc-800
	runway: '#71717a', // zinc-500
	airportArea: '#1f1f23',
	label: '#a1a1aa', // zinc-400
	minorLabel: '#71717a', // zinc-500
	halo: '#09090b' // zinc-950
};

export function mapStyle(): StyleSpecification {
	return {
		version: 8,
		glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
		sources: {
			openmaptiles: {
				type: 'vector',
				url: 'https://tiles.openfreemap.org/planet'
			},
			terrain: {
				type: 'raster-dem',
				tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
				encoding: 'terrarium',
				tileSize: 256,
				// Finer tiles exist, but shading doesn't need them: beyond this they're stretched.
				maxzoom: 12,
				attribution:
					'<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Terrain: Mapzen, AWS</a>'
			}
		},
		layers: [
			{ id: 'background', type: 'background', paint: { 'background-color': C.land } },
			{
				id: 'wood',
				type: 'fill',
				source: 'openmaptiles',
				'source-layer': 'landcover',
				filter: ['==', ['get', 'class'], 'wood'],
				paint: { 'fill-color': C.wood }
			},
			{
				id: 'residential',
				type: 'fill',
				source: 'openmaptiles',
				'source-layer': 'landuse',
				filter: ['==', ['get', 'class'], 'residential'],
				paint: { 'fill-color': C.residential }
			},
			{
				id: 'hillshade',
				type: 'hillshade',
				source: 'terrain',
				paint: {
					'hillshade-exaggeration': 0.35,
					'hillshade-shadow-color': '#000000',
					'hillshade-highlight-color': '#3f3f46',
					'hillshade-accent-color': '#000000'
				}
			},
			{
				id: 'water',
				type: 'fill',
				source: 'openmaptiles',
				'source-layer': 'water',
				filter: ['!=', ['get', 'brunnel'], 'tunnel'],
				paint: { 'fill-color': C.water }
			},
			{
				id: 'waterway',
				type: 'line',
				source: 'openmaptiles',
				'source-layer': 'waterway',
				minzoom: 8,
				filter: ['==', ['get', 'class'], 'river'],
				paint: { 'line-color': C.waterway, 'line-width': 1 }
			},
			{
				id: 'airport-area',
				type: 'fill',
				source: 'openmaptiles',
				'source-layer': 'aeroway',
				minzoom: 10,
				filter: ['==', ['get', 'class'], 'aerodrome'],
				paint: { 'fill-color': C.airportArea }
			},
			{
				id: 'roads',
				type: 'line',
				source: 'openmaptiles',
				'source-layer': 'transportation',
				minzoom: 8,
				filter: ['match', ['get', 'class'], ['trunk', 'primary'], true, false],
				layout: { 'line-cap': 'round', 'line-join': 'round' },
				paint: {
					'line-color': C.road,
					'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 3]
				}
			},
			{
				id: 'motorways',
				type: 'line',
				source: 'openmaptiles',
				'source-layer': 'transportation',
				minzoom: 5,
				filter: ['==', ['get', 'class'], 'motorway'],
				layout: { 'line-cap': 'round', 'line-join': 'round' },
				paint: {
					'line-color': C.motorway,
					'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 14, 4]
				}
			},
			{
				id: 'runways',
				type: 'line',
				source: 'openmaptiles',
				'source-layer': 'aeroway',
				minzoom: 8,
				filter: ['==', ['get', 'class'], 'runway'],
				paint: {
					'line-color': C.runway,
					// Runways are 45–60 m wide: a hairline from afar, true width when close.
					'line-width': ['interpolate', ['exponential', 2], ['zoom'], 8, 1, 12, 3, 16, 40]
				}
			},
			{
				id: 'states',
				type: 'line',
				source: 'openmaptiles',
				'source-layer': 'boundary',
				minzoom: 5,
				filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
				paint: { 'line-color': C.state, 'line-width': 0.75, 'line-dasharray': [3, 2] }
			},
			{
				id: 'countries',
				type: 'line',
				source: 'openmaptiles',
				'source-layer': 'boundary',
				filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
				paint: { 'line-color': C.border, 'line-width': 1.25 }
			},
			{
				id: 'airports',
				type: 'symbol',
				source: 'openmaptiles',
				'source-layer': 'aerodrome_label',
				minzoom: 7,
				// The four-letter ICAO code (EDDB) is what pilots and controllers use; the IATA
				// code (BER) is the one on luggage tags. Small airfields often only have a name.
				filter: ['has', 'icao'],
				layout: {
					'text-field': ['get', 'icao'],
					'text-font': FONT,
					'text-size': 11,
					'text-letter-spacing': 0.1
				},
				paint: { 'text-color': C.label, 'text-halo-color': C.halo, 'text-halo-width': 1.5 }
			},
			{
				id: 'places',
				type: 'symbol',
				source: 'openmaptiles',
				'source-layer': 'place',
				filter: ['match', ['get', 'class'], ['city', 'town'], true, false],
				minzoom: 5,
				layout: {
					'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
					'text-font': FONT,
					'text-size': ['match', ['get', 'class'], 'city', 12, 10],
					// Big cities first when labels compete for space.
					'symbol-sort-key': ['get', 'rank']
				},
				paint: {
					'text-color': ['match', ['get', 'class'], 'city', C.label, C.minorLabel],
					'text-halo-color': C.halo,
					'text-halo-width': 1.5
				}
			},
			{
				id: 'countries-label',
				type: 'symbol',
				source: 'openmaptiles',
				'source-layer': 'place',
				maxzoom: 7,
				filter: ['==', ['get', 'class'], 'country'],
				layout: {
					// In English ("Norway", not "Norge"); the local name if a country has none.
					'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']],
					'text-font': FONT,
					'text-size': 11,
					'text-transform': 'uppercase',
					'text-letter-spacing': 0.15
				},
				paint: { 'text-color': C.minorLabel, 'text-halo-color': C.halo, 'text-halo-width': 1.5 }
			}
		]
	};
}
