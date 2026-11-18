/**
 * The radars the finder confirmed (lib/radar/finder.ts), for the tracker's experimental
 * Radars layer: a symbol at each, its uncertainty ellipse, and its beam sweeping round.
 *
 * The ellipse is the jackknife's (resection.ts spread): how far the position moves when
 * each aircraft is left out, two standard errors, but at least MIN_ELLIPSE_KM either way
 * (finder.ts shownSpread). Far radars get long thin ones, pointing along the line of sight
 * from the aircraft: the bearings pin the radar down sideways, but hardly how far away it is.
 *
 * The beam is the fit's prediction, not something we receive: β(t) = 360° · (t − t₀) / P
 * from the fitted phase and period, on the server's clock (Radar.offset converts). It
 * should pass over each aircraft just as that aircraft's replies come in. Drawn only while
 * the radar is heard (BEAM_FRESH_MS): even a period good to 0.1 ms drifts a degree every
 * few minutes. The selected radar's beam gets a fading tail, like the afterglow on an old
 * radar screen; the others a faint line.
 *
 * Pure functions: the layers are in routes/TrackerMap.svelte.
 */
import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { destination } from '#lib/geo.ts';
import { ellipsePoints, lngLat } from './geometry.ts';
import { BEAM_FRESH_MS, beamAt, shownSpread, type Radar } from '#lib/radar/finder.ts';

/** The selected radar's tail: this many lines, this many degrees apart, fading. */
const TAIL_LINES = 10;
const TAIL_STEP = 2.5;
/** Beams reach this much further than the furthest aircraft the radar was seen asking. */
const BEAM_MARGIN = 1.15;
/** Each beam is drawn in this many pieces. */
const BEAM_SEGMENTS = 8;
/** The ellipse's outline, points. */
const ELLIPSE_POINTS = 72;

export interface RadarProperties {
	id: string;
	/** "SI 44 · 5.00 s" */
	label: string;
	selected: boolean;
	/** Heard within BEAM_FRESH_MS: else drawn dimmer. */
	heard: boolean;
}

/**
 * "SI 44 · 5.00 s". Two decimals: radars near each other often turn at nearly the same
 * rate (SI 1 4.00 s and SI 28 3.96 s, 20–30 km apart near Bratislava), and with one
 * decimal both read "4.0 s", as if they were one radar found twice.
 */
export function radarLabel(radar: Radar): string {
	return `${radar.id} · ${(radar.period / 1000).toFixed(2)} s`;
}

/** The symbols and the ellipses: when the radars or the selection change. */
export function radarFeatures(
	radars: Radar[],
	selected: string | null,
	now: number
): {
	sites: FeatureCollection<Point, RadarProperties>;
	ellipses: FeatureCollection<Polygon, RadarProperties>;
} {
	const props = (r: Radar): RadarProperties => ({
		id: r.id,
		label: radarLabel(r),
		selected: r.id === selected,
		heard: now - r.heard <= BEAM_FRESH_MS
	});
	return {
		sites: {
			type: 'FeatureCollection',
			features: radars.map((r) => ({
				type: 'Feature',
				properties: props(r),
				geometry: { type: 'Point', coordinates: lngLat(r.position) }
			}))
		},
		ellipses: {
			type: 'FeatureCollection',
			features: radars.map((r) => ({
				type: 'Feature',
				properties: props(r),
				geometry: { type: 'Polygon', coordinates: [ellipse(r)] }
			}))
		}
	};
}

/** The uncertainty ellipse as a ring of [lon, lat]. */
export function ellipse(radar: Radar): [number, number][] {
	const { major, minor, bearing } = shownSpread(radar);
	return ellipsePoints(radar.position, major, minor, bearing, ELLIPSE_POINTS);
}

export interface BeamProperties {
	selected: boolean;
	/** 1 for the beam itself, less along the tail. */
	opacity: number;
}

/** The beams at server time `now`: every animation frame. */
export function beamFeatures(
	radars: Radar[],
	selected: string | null,
	now: number
): FeatureCollection<LineString, BeamProperties> {
	const features: Feature<LineString, BeamProperties>[] = [];
	for (const r of radars) {
		if (now - r.heard > BEAM_FRESH_MS) continue;
		const beam = beamAt(r, now);
		const length = r.reach * BEAM_MARGIN;
		const isSelected = r.id === selected;
		// The tail trails behind: anticlockwise of the beam for a clockwise radar.
		const behind = r.clockwise ? -1 : 1;
		for (let i = 0; i < (isSelected ? TAIL_LINES : 1); i++) {
			const towards = beam + behind * i * TAIL_STEP;
			features.push({
				type: 'Feature',
				properties: { selected: isSelected, opacity: 1 - i / TAIL_LINES },
				geometry: {
					type: 'LineString',
					// Along the great circle (the beam's path), not straight on the flat map.
					coordinates: Array.from({ length: BEAM_SEGMENTS + 1 }, (_, k) => {
						return lngLat(destination(r.position, towards, (length * k) / BEAM_SEGMENTS));
					})
				}
			});
		}
	}
	return { type: 'FeatureCollection', features };
}
