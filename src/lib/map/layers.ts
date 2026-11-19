/**
 * The map's own sources and layers, on top of the base map (style.ts): what each draws and
 * how, in drawing order (the first at the bottom). TrackerMap adds them once the style has
 * loaded, and then only feeds the sources (features.ts, coverage.ts, radars.ts, winds.ts) and
 * switches layers on and off (LAYER_IDS, by MapLayers.svelte's switches).
 */
import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl';
import { altitudeColour } from './altitude.ts';
import { STALE_OPACITY } from './features.ts';
import { BARB_BELOW } from './winds.ts';

/** The map's switches (MapLayers.svelte): each true while what it names is drawn. */
export interface Layers {
	rings: boolean;
	trail: boolean;
	prediction: boolean;
	uncertainty: boolean;
	winds: boolean;
	/** How far the antenna hears, per altitude band, and the radio horizon. */
	coverage: boolean;
	/** Experimental: the ground radars found from the replies. Off: not searched for. */
	radars: boolean;
	/** Base map: motorways, trunk and primary roads. */
	roads: boolean;
	/** Base map: city and town names. */
	places: boolean;
}

/**
 * The trails' width and opacity: the selected aircraft's (`icao`) wider and brighter, the
 * others dimmed while one is selected (TrackerMap's selection effect). A bridge across a gap
 * (features.ts) thinner and fainter than the trail it joins: nobody heard the aircraft there.
 */
export function trailPaint(icao: string | null) {
	const mine: ExpressionSpecification = ['==', ['get', 'icao'], icao ?? ''];
	const bridge: ExpressionSpecification = ['==', ['get', 'bridge'], true];
	return {
		'line-width': ['*', ['case', mine, 3, 1.5], ['case', bridge, 0.6, 1]],
		'line-opacity': ['*', ['case', mine, 1, icao ? 0.35 : 0.7], ['case', bridge, 0.5, 1]]
	} satisfies Record<string, ExpressionSpecification>;
}

/** Our GeoJSON sources, one per kind of thing drawn, all empty until TrackerMap fills them. */
export const SOURCES = [
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
] as const;
export type SourceId = (typeof SOURCES)[number];

/** The map layers each switch shows or hides. The trail switch filters instead (TrackerMap). */
export const LAYER_IDS: Record<Exclude<keyof Layers, 'trail'>, string[]> = {
	prediction: ['prediction', 'prediction-ticks', 'prediction-minutes'],
	uncertainty: ['accuracy', 'containment', 'uncertainty-unknown'],
	rings: ['rings', 'ring-labels'],
	winds: ['winds'],
	// Also shown while the receiver's panel is open (TrackerMap's `coverageShown`).
	coverage: ['coverage-horizon', 'coverage-horizon-label', 'coverage-fill', 'coverage-outline'],
	radars: ['radar-ellipse-fill', 'radar-ellipses', 'radar-beams', 'radar-sites'],
	// The base map's own layers (style.ts). Borders, terrain and airports always stay.
	roads: ['roads', 'motorways'],
	places: ['places']
};

const FONT = ['Noto Sans Regular'];
const HALO = '#09090b';
/** The horizon's amber (amber-300), as on the sky plot. */
const HORIZON_COLOUR = '#fcd34d';

/** Alert colours: red-500 for emergencies, amber-400 for cautions (as the banner). */
export const TIER_COLOUR: ExpressionSpecification = [
	'match',
	['get', 'tier'],
	'emergency',
	'#ef4444',
	'#fbbf24'
];
/** The label's colour: the alert's, or the normal one. */
const LABEL_COLOUR: ExpressionSpecification = [
	'match',
	['get', 'tier'],
	'',
	'#f4f4f5',
	TIER_COLOUR
];

/**
 * The aircraft symbols' opacity: dimmed in IDENT's blink, faded once stale (features.ts). With
 * `answered` (the aircraft that answered the open radar), the others faint.
 */
export function aircraftOpacity(answered: string[] | null): ExpressionSpecification {
	const normal: ExpressionSpecification = [
		'case',
		['get', 'dim'],
		0.15,
		['get', 'stale'],
		STALE_OPACITY,
		1
	];
	return answered ? ['case', ['in', ['get', 'icao'], ['literal', answered]], normal, 0.25] : normal;
}

/**
 * A radius given in pixels at zoom 0 (features.ts, uncertainty), to scale: doubling with every
 * zoom level.
 */
const toScale = (key: string): ExpressionSpecification => [
	'interpolate',
	['exponential', 2],
	['zoom'],
	0,
	['get', key],
	24,
	['*', ['get', key], 2 ** 24]
];

/** Every layer of ours, bottom first. */
export function mapLayers(): LayerSpecification[] {
	return [
		{
			id: 'rings',
			type: 'line',
			source: 'rings',
			paint: { 'line-color': '#52525b', 'line-width': 1, 'line-dasharray': [4, 4] }
		},
		{
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
		},
		// Coverage: background, like the rings. The sector picked on the sky plot as a faint
		// wedge, the horizon dashed amber, the outlines in their band's colour.
		{
			id: 'coverage-sector',
			type: 'fill',
			source: 'coverage-sector',
			paint: { 'fill-color': '#f4f4f5', 'fill-opacity': 0.08 }
		},
		{
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
		},
		{
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
		},
		{
			id: 'coverage-fill',
			type: 'fill',
			source: 'coverage-outline',
			paint: { 'fill-color': altitudeColour(), 'fill-opacity': 0.05 }
		},
		{
			id: 'coverage-outline',
			type: 'line',
			source: 'coverage-outline',
			layout: { 'line-join': 'round' },
			paint: { 'line-color': altitudeColour(), 'line-width': 1, 'line-opacity': 0.6 }
		},
		{
			id: 'coverage-points',
			type: 'circle',
			source: 'coverage-points',
			paint: {
				'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 1, 9, 2.5],
				'circle-color': altitudeColour(),
				'circle-opacity': 0.5
			}
		},
		// Radars: the ellipses and beams faint, under the aircraft and their trails.
		{
			id: 'radar-ellipse-fill',
			type: 'fill',
			source: 'radar-ellipses',
			paint: {
				'fill-color': '#e4e4e7', // zinc-200
				'fill-opacity': ['case', ['get', 'selected'], 0.12, 0.05]
			}
		},
		{
			id: 'radar-ellipses',
			type: 'line',
			source: 'radar-ellipses',
			paint: {
				'line-color': '#d4d4d8', // zinc-300
				'line-width': ['case', ['get', 'selected'], 1.5, 1],
				'line-opacity': ['case', ['get', 'selected'], 0.8, 0.4],
				'line-dasharray': [2, 2]
			}
		},
		{
			id: 'radar-beams',
			type: 'line',
			source: 'radar-beams',
			layout: { 'line-cap': 'round' },
			paint: {
				'line-color': '#f4f4f5', // zinc-100
				'line-width': ['case', ['get', 'selected'], 2, 1],
				'line-opacity': ['*', ['get', 'opacity'], ['case', ['get', 'selected'], 0.55, 0.3]]
			}
		},
		// The route: under everything the aircraft draw, faint, so it reads as background.
		// Dash-dot, unlike the dashed range rings and the dotted predictions.
		{
			id: 'route',
			type: 'line',
			source: 'route',
			paint: {
				'line-color': '#a1a1aa', // zinc-400
				'line-width': 1.5,
				'line-opacity': 0.8,
				'line-dasharray': [6, 3, 1, 3]
			}
		},
		{
			id: 'route-airport-dots',
			type: 'circle',
			source: 'route-airports',
			paint: {
				'circle-radius': 3.5,
				'circle-color': '#a1a1aa',
				'circle-stroke-color': HALO,
				'circle-stroke-width': 1.5
			}
		},
		{
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
		},
		...(['trails', 'heads'] as const).map((id): LayerSpecification => ({
			id,
			type: 'line',
			source: id,
			layout: { 'line-cap': 'round' },
			paint: { 'line-color': altitudeColour(), ...trailPaint(null) }
		})),
		// Wind barbs: over the trails they were measured on, under everything else. They give
		// way to each other (the newest stays) and to the aircraft labels.
		{
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
		},
		// Uncertainty, to scale (toScale): accuracy filled, containment as a ring.
		{
			id: 'accuracy',
			type: 'circle',
			source: 'uncertainty',
			filter: ['has', 'accuracy'],
			paint: {
				'circle-radius': toScale('accuracy'),
				'circle-color': altitudeColour(),
				'circle-opacity': 0.15
			}
		},
		{
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
		},
		// Neither accuracy nor integrity known: a fixed-size amber ring, a warning.
		{
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
		},
		// Dots: zero-length dashes with round caps, a gap of 2.5 line widths between them.
		{
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
		},
		{
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
		},
		{
			id: 'prediction-ticks',
			type: 'circle',
			source: 'prediction-minutes',
			paint: {
				'circle-radius': 2.5,
				'circle-color': '#f4f4f5',
				'circle-stroke-color': HALO,
				'circle-stroke-width': 1
			}
		},
		// The airport whose panel is open: a ring round its label (centred on the point;
		// 22 px clears a four-letter code).
		{
			id: 'airport-selected',
			type: 'circle',
			source: 'airport-selected',
			paint: {
				'circle-radius': 22,
				'circle-color': 'rgba(244,244,245,0.05)',
				'circle-stroke-color': '#f4f4f5',
				'circle-stroke-width': 1.5
			}
		},
		// The receiver; ringed like a selected aircraft while its panel is open.
		{
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
		},
		{
			id: 'receiver',
			type: 'circle',
			source: 'receiver',
			paint: {
				'circle-radius': 4,
				'circle-color': '#f4f4f5',
				'circle-stroke-color': HALO,
				'circle-stroke-width': 2
			}
		},
		// Radar sites: over the receiver, under the aircraft, whose labels go first. Radars
		// near each other (SI 1 and SI 28 near Bratislava, 20–30 km apart) would hide each
		// other's label at the bottom, so it may move to any side.
		{
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
		},
		// ACAS advisories: the two aircraft joined by a line, with how far apart vertically.
		{
			id: 'alert-links',
			type: 'line',
			source: 'alert-links',
			paint: { 'line-color': TIER_COLOUR, 'line-width': 2, 'line-dasharray': [2, 1.5] }
		},
		{
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
		},
		// When an alert starts: rings pulsing out from the symbol (features.ts PULSES).
		{
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
		},
		// Larger and bolder than the amber "integrity unknown" ring (13 px, thin), and
		// outside the selection ring (17 px), so all three can be told apart.
		{
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
		},
		{
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
		},
		{
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
				// (Set again while a radar is open: TrackerMap's `answered`.)
				'icon-opacity': aircraftOpacity(null),
				// The badge alone (zoomed out) in the alert's colour; with the label, the
				// format above colours the badge.
				'text-color': ['step', ['zoom'], LABEL_COLOUR, 7, '#d4d4d8'],
				'text-halo-color': HALO,
				'text-halo-width': 1.5,
				'text-opacity': ['case', ['get', 'stale'], STALE_OPACITY, 1]
			}
		}
	];
}
