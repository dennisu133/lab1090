/**
 * What the map draws, as GeoJSON: aircraft, their trails, the range rings. Pure functions
 * of the tracker's snapshots and the time, so the map component only hands them to MapLibre.
 *
 * Dead reckoning: a position is up to half a second old when it arrives, and the next one
 * may be a few seconds away (missed messages). Drawn as is, planes would jump. So each one is
 * moved along from its last position with its ground speed and track, like a navigator
 * without GPS ("deduced reckoning"): distance = speed × time since the position. Straight
 * ahead only, so it's wrong in a turn; that's why it stops after EXTRAPOLATE_MS.
 */
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { destination, KM_PER_NM } from '#lib/geo.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import type { TrackedAircraft } from '#lib/tracker/tracker.ts';
import { iconFor } from './icons';

/** A position older than this isn't drawn: the aircraft is out of reach, or stopped sending. */
export const SHOW_MS = 30_000;
/** Drawn faded from this age on: "it was here a while ago". */
export const STALE_MS = 10_000;
/** Moved along for at most this long; then it waits where the guess ended. */
export const EXTRAPOLATE_MS = 15_000;
/** A ground speed this much older than the position isn't used to move it along. */
const SPEED_MS = 10_000;

export type Unit = 'NM' | 'km';

export interface Shown extends LatLon {
	/** ms since the last real position. */
	age: number;
	/** How far it was moved along, km (0: not at all). */
	extrapolatedKm: number;
}

/** Where to draw an aircraft now; null if not at all (no confirmed position, or too old). */
export function shownPosition(a: TrackedAircraft, now: number): Shown | null {
	const p = a.position;
	if (!p || !a.confirmed) return null;
	const age = Math.max(0, now - p.t);
	if (age > SHOW_MS) return null;
	const g = a.ground;
	// On the ground: no ADS-B velocity, and taxiing is too slow to matter.
	if (p.surface || !g || p.t - g.t > SPEED_MS)
		return { lat: p.lat, lon: p.lon, age, extrapolatedKm: 0 };
	const km = (g.value.speed * KM_PER_NM * Math.min(age, EXTRAPOLATE_MS)) / 3_600_000;
	return { ...destination(p, g.value.track, km), age, extrapolatedKm: km };
}

/** The direction the symbol points: the ground track, or on the ground the surface direction. */
function direction(a: TrackedAircraft): number {
	if (a.position?.surface) return a.surface?.value.direction ?? 0;
	return a.ground?.value.track ?? a.commB.trackAndTurn?.value.track ?? 0;
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
				track: direction(a),
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
