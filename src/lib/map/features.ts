/**
 * What the map draws, as GeoJSON: aircraft, their trails, the range rings. Pure functions
 * of the tracker's snapshots and the time, so the map component only hands them to MapLibre.
 *
 * Dead reckoning: a position is up to half a second old when it arrives, and the next one
 * may be a few seconds away (missed messages). Drawn as is, planes would jump. So each one is
 * moved along from its last position with its ground speed and track, like a navigator
 * without GPS ("deduced reckoning"): distance = speed × time since the position. In a turn
 * it follows the arc at the measured turn rate (lib/tracker/motion.ts). It's still a
 * guess, so it stops after EXTRAPOLATE_MS.
 *
 * The predicted path goes on from there, with the same model: a dotted line ahead of each
 * aircraft (PREDICT_S), longer with minute marks for the selected one (PREDICT_SELECTED_S).
 * Radar screens in air traffic control draw the same thing, straight, as a "speed vector"
 * or "velocity leader": where the aircraft will be in a minute or two.
 */
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { destination, KM_PER_NM } from '#lib/geo.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { advance, headingReference, motion, path, trueHeading } from '#lib/tracker/motion.ts';
import type { TrackedAircraft } from '#lib/tracker/tracker.ts';
import { iconFor } from './icons';

/** A position older than this isn't drawn: the aircraft is out of reach, or stopped sending. */
export const SHOW_MS = 30_000;
/** Drawn faded from this age on: "it was here a while ago". */
export const STALE_MS = 10_000;
/** Moved along for at most this long; then it waits where the guess ended. */
export const EXTRAPOLATE_MS = 15_000;
/** How far ahead the dotted line goes, s: for every aircraft, and for the selected one. */
export const PREDICT_S = 60;
export const PREDICT_SELECTED_S = 180;
/** The predicted path is drawn in pieces of this many seconds, each in its altitude's colour. */
const PREDICT_STEP_S = 5;

export type Unit = 'NM' | 'km';

export interface Shown extends LatLon {
	/** ms since the last real position. */
	age: number;
	/** How far it was moved along, km (0: not at all). */
	extrapolatedKm: number;
	/** Where it points: the ground track (turned along in a turn), else see direction(). */
	track: number;
}

/** Where to draw an aircraft now; null if not at all (no confirmed position, or too old). */
export function shownPosition(a: TrackedAircraft, now: number): Shown | null {
	const p = a.position;
	if (!p || !a.confirmed) return null;
	const age = Math.max(0, now - p.t);
	if (age > SHOW_MS) return null;
	// On the ground: no ADS-B velocity, and taxiing is too slow to matter.
	const m = motion(a);
	if (!m) return { lat: p.lat, lon: p.lon, age, extrapolatedKm: 0, track: direction(a) };
	const seconds = Math.min(age, EXTRAPOLATE_MS) / 1000;
	const s = advance(p, m, seconds);
	return {
		lat: s.lat,
		lon: s.lon,
		age,
		extrapolatedKm: distance(m.speed, seconds),
		track: s.track
	};
}

/** km covered at `kt` in `seconds`. */
const distance = (kt: number, seconds: number) => (kt * KM_PER_NM * seconds) / 3600;

/**
 * Where the symbol points without a ground velocity: on the ground the surface direction;
 * in the air the heading (TC 19 subtypes 3/4: where the nose points, a few degrees off the
 * track), else the track a radar read from register 5,0.
 */
function direction(a: TrackedAircraft): number {
	if (a.position?.surface) return a.surface?.value.direction ?? 0;
	if (a.ground) return a.ground.value.track;
	const heading = a.air?.value.heading;
	if (heading != null) return trueHeading(heading, headingReference(a), a.position, a.air!.t);
	return a.commB.trackAndTurn?.value.track ?? 0;
}

/** "FL350" for 35,000 ft: the altitude in hundreds of feet, as ATC says it (see describe/aircraft.ts). */
export function flightLevel(feet: number): string {
	return `FL${String(Math.round(feet / 100)).padStart(3, '0')}`;
}

/** Callsign (or address) and flight level, for the label under the symbol. */
function label(a: TrackedAircraft): string {
	const name = a.callsign?.value ?? a.icao;
	if (a.position?.surface) return `${name}\nGND`;
	return a.altitude ? `${name}\n${flightLevel(a.altitude.value)}` : name;
}

export interface AircraftProperties {
	icao: string;
	label: string;
	icon: string;
	size: number;
	track: number;
	altitude: number | null;
	ground: boolean;
	stale: boolean;
}

/** One point per aircraft on the map. */
export function aircraftFeatures(
	list: TrackedAircraft[],
	now: number
): FeatureCollection<Point, AircraftProperties> {
	const features: Feature<Point, AircraftProperties>[] = [];
	for (const a of list) {
		const shown = shownPosition(a, now);
		if (!shown) continue;
		const { icon, size } = iconFor(a.category?.value ?? null);
		features.push({
			type: 'Feature',
			id: a.icao,
			geometry: { type: 'Point', coordinates: [shown.lon, shown.lat] },
			properties: {
				icao: a.icao,
				label: label(a),
				icon,
				size,
				track: shown.track,
				altitude: a.position!.surface ? null : (a.altitude?.value ?? null),
				ground: a.position!.surface,
				stale: shown.age > STALE_MS
			}
		});
	}
	return { type: 'FeatureCollection', features };
}

export interface TrailProperties {
	icao: string;
	altitude: number | null;
	ground: boolean;
}

function line(
	icao: string,
	from: LatLon,
	to: LatLon,
	altitude: number | null,
	ground: boolean
): Feature<LineString, TrailProperties> {
	return {
		type: 'Feature',
		geometry: {
			type: 'LineString',
			coordinates: [
				[from.lon, from.lat],
				[to.lon, to.lat]
			]
		},
		properties: { icao, altitude, ground }
	};
}

/**
 * Trails as short lines, one per pair of neighbouring points, each in the colour of its
 * altitude: a climbing aircraft leaves a trail that changes colour. Only for aircraft on
 * the map at `now`.
 */
export function trailFeatures(
	list: TrackedAircraft[],
	now: number
): FeatureCollection<LineString, TrailProperties> {
	const features: Feature<LineString, TrailProperties>[] = [];
	for (const a of list) {
		if (!shownPosition(a, now)) continue;
		for (const segment of a.trail) {
			for (let i = 1; i < segment.length; i++) {
				const p = segment[i];
				features.push(line(a.icao, segment[i - 1], p, p.altitude, p.ground));
			}
		}
	}
	return { type: 'FeatureCollection', features };
}

/**
 * The piece from each aircraft's last real position to where it's drawn now, so the trail
 * reaches the symbol while it's moved along. Separate from the trails: this changes every
 * animation frame, the trails only with new positions.
 */
export function headFeatures(
	list: TrackedAircraft[],
	now: number
): FeatureCollection<LineString, TrailProperties> {
	const features: Feature<LineString, TrailProperties>[] = [];
	for (const a of list) {
		const shown = shownPosition(a, now);
		const last = a.trail.at(-1)?.at(-1);
		if (shown && last && shown.extrapolatedKm > 0)
			features.push(line(a.icao, last, shown, last.altitude, last.ground));
	}
	return { type: 'FeatureCollection', features };
}

export interface PredictionProperties {
	icao: string;
	altitude: number | null;
	ground: false;
}

/**
 * The predicted path ahead of each aircraft on the map (see the top of this file), as short
 * lines in the colour of the altitude predicted there: a climbing aircraft's line changes
 * colour, and stops changing where it levels off. Only for aircraft that are moved along,
 * and not once they're faded (STALE_MS): an old guess shouldn't look like a fresh one.
 * `minutes` gets a point at every full minute along the selected aircraft's path.
 */
export function predictionFeatures(
	list: TrackedAircraft[],
	now: number,
	selected: string | null
): {
	lines: FeatureCollection<LineString, PredictionProperties>;
	minutes: FeatureCollection<Point, { label: string }>;
} {
	const lines: Feature<LineString, PredictionProperties>[] = [];
	const minutes: Feature<Point, { label: string }>[] = [];
	for (const a of list) {
		const shown = shownPosition(a, now);
		const m = motion(a);
		if (!shown || !m || shown.age > STALE_MS || shown.age > EXTRAPOLATE_MS) continue;
		const start = advance(a.position!, m, shown.age / 1000);
		const mine = a.icao === selected;
		const { points } = path(start, m, mine ? PREDICT_SELECTED_S : PREDICT_S, PREDICT_STEP_S);
		for (let i = 1; i < points.length; i++) {
			const [from, to] = [points[i - 1], points[i]];
			lines.push({
				type: 'Feature',
				geometry: {
					type: 'LineString',
					coordinates: [
						[from.lon, from.lat],
						[to.lon, to.lat]
					]
				},
				properties: { icao: a.icao, altitude: to.altitude, ground: false }
			});
			const seconds = i * PREDICT_STEP_S;
			if (mine && seconds % 60 === 0)
				minutes.push({
					type: 'Feature',
					geometry: { type: 'Point', coordinates: [to.lon, to.lat] },
					properties: { label: `${seconds / 60} min` }
				});
		}
	}
	return {
		lines: { type: 'FeatureCollection', features: lines },
		minutes: { type: 'FeatureCollection', features: minutes }
	};
}

/** Ring radii: round numbers that cover what a receiver like this one hears. */
export const RINGS: Record<Unit, number[]> = {
	NM: [25, 50, 100, 150, 200],
	km: [50, 100, 200, 300, 400]
};

/**
 * Circles around the receiver at equal distances, as a radar screen has them: true circles
 * on the globe (every point the same great-circle distance away), so on the map they're
 * very slightly egg-shaped at this latitude. The labels sit at the top of each ring.
 */
export function ringFeatures(
	receiver: LatLon,
	unit: Unit
): { rings: FeatureCollection<LineString>; labels: FeatureCollection<Point, { label: string }> } {
	const km = (d: number) => (unit === 'NM' ? d * KM_PER_NM : d);
	return {
		rings: {
			type: 'FeatureCollection',
			features: RINGS[unit].map((d) => ({
				type: 'Feature',
				properties: {},
				geometry: {
					type: 'LineString',
					coordinates: Array.from({ length: 129 }, (_, i) => {
						const p = destination(receiver, (i * 360) / 128, km(d));
						return [p.lon, p.lat];
					})
				}
			}))
		},
		labels: {
			type: 'FeatureCollection',
			features: RINGS[unit].map((d) => {
				const p = destination(receiver, 0, km(d));
				return {
					type: 'Feature',
					properties: { label: `${d} ${unit}` },
					geometry: { type: 'Point', coordinates: [p.lon, p.lat] }
				};
			})
		}
	};
}
