/**
 * The radars the finder confirmed (lib/radar/finder.ts), for the radar experiment's map
 * (/experimental/radars): a symbol at each, its uncertainty ellipse, and its beam sweeping
 * round.
 *
 * The ellipse is the jackknife's (resection.ts spread): how far the position moves when
 * each aircraft is left out, two standard errors. Far radars get long thin ones, pointing
 * along the line of sight from the aircraft: the bearings pin the radar down sideways, but
 * hardly how far away it is.
 *
 * The beam is the fit's prediction, not something we receive: β(t) = 360° · (t − t₀) / P
 * from the fitted phase and period, on the server's clock (Radar.offset converts). It
 * should pass over each aircraft just as that aircraft's replies come in. Drawn only while
 * the radar is heard (BEAM_FRESH_MS): even a period good to 0.1 ms drifts a degree every
 * few minutes. The selected radar's beam gets a fading tail, like the afterglow on an old
 * radar screen; the others a faint line.
 *
 * Pure functions: the layers are in routes/experimental/radars/RadarMap.svelte.
 */
import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { destination } from '#lib/geo.ts';
import { BEAM_FRESH_MS, beamAt, type Radar } from '#lib/radar/finder.ts';

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
	/** "SI 44 · 5.0 s" */
	label: string;
	selected: boolean;
	/** Heard within BEAM_FRESH_MS: else drawn dimmer. */
	heard: boolean;
}

/** "SI 44 · 5.0 s" */
export function radarLabel(radar: Radar): string {
	return `${radar.id} · ${(radar.period / 1000).toFixed(1)} s`;
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
				geometry: { type: 'Point', coordinates: [r.position.lon, r.position.lat] }
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
	const { major, minor, bearing } = radar.spread;
	return Array.from({ length: ELLIPSE_POINTS + 1 }, (_, i) => {
		const a = (2 * Math.PI * i) / ELLIPSE_POINTS;
		const along = destination(radar.position, bearing, major * Math.cos(a));
		const p = destination(along, bearing + 90, minor * Math.sin(a));
		return [p.lon, p.lat];
	});
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
						const p = destination(r.position, towards, (length * k) / BEAM_SEGMENTS);
						return [p.lon, p.lat];
					})
				}
			});
		}
	}
	return { type: 'FeatureCollection', features };
}
