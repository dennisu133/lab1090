/**
 * The tracker's experimental GNSS layer (lib/gnss/watch.ts): the grid's cells shaded by the
 * share of their aircraft without good satellite navigation, the stretches flown degraded,
 * and the places where aircraft lost it and got it back.
 *
 * - Cells: faint green where every aircraft was fine, amber where some weren't, red where
 *   many were (watch.ts MANY_SHARE). Only cells with enough aircraft to say (MIN_AIRCRAFT).
 * - Stretches: a wide amber band under the trails, like a highlighter. Dashed for aircraft
 *   that arrived degraded: they lost GNSS somewhere else.
 * - Changes: a red dot where an aircraft lost it, a green ring where it got it back. An
 *   aircraft that sent no positions in between (TC 0) gets a thin red dashed line from one
 *   to the other: it flew there blind, by its own reckoning, probably about straight. Only
 *   if it could have: covering the line in the time took at most MAX_SPEED_KT (a replay's
 *   --loop jumps aircraft back to where they started).
 *
 * Pure functions: the layers are in layers.ts, drawn by routes/TrackerMap.svelte.
 */
import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { distanceKm } from '#lib/geo.ts';
import type { Cell, CellLevel, Change, Stretch } from '#lib/gnss/watch.ts';
import { MAX_SPEED_KT } from '#lib/tracker/positions.ts';
import { KT } from '#lib/units.ts';
import { lngLat } from './geometry.ts';

export interface CellProperties {
	key: string;
	level: CellLevel;
	selected: boolean;
}

export function cellFeatures(
	cells: Cell[],
	selected: string | null
): FeatureCollection<Polygon, CellProperties> {
	return {
		type: 'FeatureCollection',
		features: cells.map((c) => ({
			type: 'Feature',
			properties: { key: c.key, level: c.level, selected: c.key === selected },
			geometry: { type: 'Polygon', coordinates: [c.ring] }
		}))
	};
}

export interface StretchProperties {
	icao: string;
	arrived: boolean;
}

export function stretchFeatures(
	stretches: Stretch[]
): FeatureCollection<LineString, StretchProperties> {
	return {
		type: 'FeatureCollection',
		features: stretches.map((s) => ({
			type: 'Feature',
			properties: { icao: s.icao, arrived: s.arrived },
			geometry: { type: 'LineString', coordinates: s.points.map(lngLat) }
		}))
	};
}

export interface ChangeProperties {
	id: number;
	kind: Change['kind'];
	selected: boolean;
}

/** The changes with a place, and the blind lines between a loss (to TC 0) and its regaining. */
export function changeFeatures(
	changes: Change[],
	selected: number | null
): {
	points: FeatureCollection<Point, ChangeProperties>;
	blind: FeatureCollection<LineString, { icao: string }>;
} {
	const points: Feature<Point, ChangeProperties>[] = [];
	const blind: Feature<LineString, { icao: string }>[] = [];
	/** Each aircraft's latest loss, waiting for its regaining. */
	const lost = new Map<string, Change>();
	for (const c of changes) {
		if (c.at)
			points.push({
				type: 'Feature',
				properties: { id: c.id, kind: c.kind, selected: c.id === selected },
				geometry: { type: 'Point', coordinates: lngLat(c.at) }
			});
		if (c.kind === 'lost') lost.set(c.icao, c);
		else {
			const from = lost.get(c.icao);
			lost.delete(c.icao);
			if (
				from?.at &&
				c.at &&
				from.atT !== null &&
				c.atT !== null &&
				from.other === 'none' &&
				c.other === 'none' &&
				distanceKm(from.at, c.at) * 1000 <= MAX_SPEED_KT * KT * ((c.atT - from.atT) / 1000)
			)
				blind.push({
					type: 'Feature',
					properties: { icao: c.icao },
					geometry: { type: 'LineString', coordinates: [lngLat(from.at), lngLat(c.at)] }
				});
		}
	}
	return {
		points: { type: 'FeatureCollection', features: points },
		blind: { type: 'FeatureCollection', features: blind }
	};
}
