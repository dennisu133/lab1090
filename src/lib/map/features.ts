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
 *
 * Alerts (lib/tracker/alerts.ts) mark the aircraft: a ring in the alert's colour, a badge
 * above the label ("7700", "RA ↑"), a few rings pulsing out when it starts, and a line
 * between the two aircraft of an ACAS advisory. IDENT blinks the symbol, as on a
 * controller's screen. Without animations (prefers-reduced-motion), no pulse and no blink.
 */
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { DbAirport, DbRoute } from '#lib/aircraft-db.ts';
import { destination, distanceKm, intermediate, KM_PER_NM } from '#lib/geo.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { advance, headingReference, motion, path, trueHeading } from '#lib/tracker/motion.ts';
import { badge as alertBadge } from '#lib/describe/alert.ts';
import { alertsOf, identing, type Tier } from '#lib/tracker/alerts.ts';
import type { TrackedAircraft } from '#lib/tracker/tracker.ts';
import { uncertainty } from '#lib/tracker/uncertainty.ts';
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
/** When an alert starts: this many rings pulse out from the symbol, each taking PULSE_MS. */
export const PULSES = 4;
export const PULSE_MS = 1500;
/** IDENT: the symbol blinks, this long on and this long dimmed. */
const BLINK_MS = 500;

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
	/** The highest tier of its alerts; '' for none (MapLibre filters compare strings). */
	tier: Tier | '';
	/** Above the label: the alert's badge ("7700", "RA ↑"), or IDENT; '' for none. */
	badge: string;
	/** How far the onset pulse has got, 0–1; −1: none (or no animations). */
	pulse: number;
	/** IDENT's blink, in the dimmed half. */
	dim: boolean;
	/** Labels with a lower one are placed first: alerts win when labels collide. */
	sort: number;
}

/** One point per aircraft on the map. */
export function aircraftFeatures(
	list: TrackedAircraft[],
	now: number,
	/** false: the user asked for less motion (prefers-reduced-motion). */
	animate = true
): FeatureCollection<Point, AircraftProperties> {
	const features: Feature<Point, AircraftProperties>[] = [];
	for (const a of list) {
		const shown = shownPosition(a, now);
		if (!shown) continue;
		const { icon, size } = iconFor(a.category?.value ?? null);
		const alerts = alertsOf(a, now);
		const tier = alerts.some((x) => x.tier === 'emergency')
			? 'emergency'
			: alerts.length
				? 'caution'
				: '';
		const ident = identing(a, now);
		const onset = alerts.length ? now - Math.max(...alerts.map((x) => x.since)) : Infinity;
		const pulse =
			animate && onset >= 0 && onset < PULSES * PULSE_MS ? (onset % PULSE_MS) / PULSE_MS : -1;
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
				stale: shown.age > STALE_MS,
				tier,
				badge: [...alerts.map(alertBadge), ...(ident ? ['IDENT'] : [])].join(' '),
				pulse,
				dim: animate && ident && Math.floor(now / BLINK_MS) % 2 === 1,
				sort: tier === 'emergency' ? 0 : tier === 'caution' || ident ? 1 : 2
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

/**
 * Metres per pixel at zoom 0 on the equator: MapLibre's world is one 512 px tile there,
 * around 40,075,016.686 m (WGS84's equator). Each zoom level halves it; away from the
 * equator, Web Mercator stretches the map by 1 / cos(latitude), so a metre takes more pixels.
 */
const METRES_PER_PIXEL_Z0 = 40_075_016.686 / 512;

export interface UncertaintyProperties {
	icao: string;
	altitude: number | null;
	ground: boolean;
	/** The radii in pixels at zoom 0 (see METRES_PER_PIXEL_Z0); absent if unknown. */
	accuracy?: number;
	containment?: number;
	/** It says neither: NACp 0 and NIC 0 (e.g. TC 18). Drawn as a warning, not to scale. */
	unknown: boolean;
}

/**
 * Circles around each aircraft on the map, true to scale: how accurate its position is
 * (NACp, 95 %) and the radius it vouches for (NIC → Rc). See lib/modes/integrity.ts. With
 * satellite navigation working, both are tens to a couple of hundred metres: hidden under
 * the symbol until you zoom in close. Large circles mean the aircraft navigates without
 * satellites (inertial, radio beacons), or its receiver is disturbed. An aircraft that
 * states neither (NACp 0, and a type code that says "NIC 0") gets a warning ring of a fixed
 * size: in the capture, DLH895 sent positions like that. Not for faded aircraft.
 */
export function uncertaintyFeatures(
	list: TrackedAircraft[],
	now: number
): FeatureCollection<Point, UncertaintyProperties> {
	const features: Feature<Point, UncertaintyProperties>[] = [];
	for (const a of list) {
		const shown = shownPosition(a, now);
		if (!shown || shown.age > STALE_MS) continue;
		const u = uncertainty(a);
		const rc = u.containment?.rc ?? null;
		// Nothing received about it yet (no NACp, no position type code): nothing to say.
		if (u.accuracy === null && rc === null && (u.nacP === null || !u.containment)) continue;
		const scale = METRES_PER_PIXEL_Z0 * Math.cos((shown.lat * Math.PI) / 180);
		features.push({
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [shown.lon, shown.lat] },
			properties: {
				icao: a.icao,
				altitude: a.position!.surface ? null : (a.altitude?.value ?? null),
				ground: a.position!.surface,
				...(u.accuracy !== null && { accuracy: u.accuracy / scale }),
				...(rc !== null && { containment: rc / scale }),
				unknown: u.accuracy === null && rc === null
			}
		});
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

const EMPTY = { type: 'FeatureCollection' as const, features: [] };

/** The great circle of a route is drawn in pieces of at most this length (km). */
const ROUTE_STEP_KM = 25;

/**
 * The selected aircraft's route (adsbdb, lib/aircraft-db.ts): the great circle from origin
 * to destination (via the stop, if any), the shortest way on the globe, which on this flat
 * map is a curve; and the airports, labelled with their IATA code (else ICAO). Longitudes
 * are unwrapped (beyond ±180°), so a route across the Pacific doesn't jump across the world.
 */
export function routeFeatures(route: DbRoute | null): {
	line: FeatureCollection<LineString>;
	airports: FeatureCollection<Point, { label: string }>;
} {
	if (!route) return { line: EMPTY, airports: EMPTY };
	const stops = [route.origin, route.via, route.destination].filter(
		(a): a is DbAirport => a !== null
	);
	const coordinates: [number, number][] = [];
	for (let i = 1; i < stops.length; i++) {
		const [a, b] = [stops[i - 1], stops[i]];
		const pieces = Math.max(1, Math.ceil(distanceKm(a, b) / ROUTE_STEP_KM));
		for (let k = i === 1 ? 0 : 1; k <= pieces; k++) {
			const p = intermediate(a, b, k / pieces);
			const previous = coordinates.at(-1)?.[0];
			const lon =
				previous === undefined ? p.lon : previous + (((p.lon - previous + 540) % 360) - 180);
			coordinates.push([lon, p.lat]);
		}
	}
	return {
		line: {
			type: 'FeatureCollection',
			features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }]
		},
		airports: {
			type: 'FeatureCollection',
			features: stops.map((a) => ({
				type: 'Feature',
				properties: { label: a.iata ?? a.icao },
				geometry: { type: 'Point', coordinates: [a.lon, a.lat] }
			}))
		}
	};
}

export interface AlertLinkProperties {
	tier: Tier;
	/** The vertical distance between the two, "1,000 ft"; '' if an altitude is missing. */
	label: string;
}

/**
 * ACAS advisories: a line from each aircraft to the threat its advisory names, if both are on
 * the map. Both usually have one against the other at the same time: one line per pair.
 */
export function alertLinkFeatures(
	list: TrackedAircraft[],
	now: number
): FeatureCollection<LineString, AlertLinkProperties> {
	const features: Feature<LineString, AlertLinkProperties>[] = [];
	const drawn = new Set<string>();
	for (const a of list) {
		for (const x of alertsOf(a, now)) {
			if (x.kind !== 'advisory' || !x.threat) continue;
			const pair = [a.icao, x.threat].sort().join(' ');
			const other = list.find((o) => o.icao === x.threat);
			const from = shownPosition(a, now);
			const to = other && shownPosition(other, now);
			if (drawn.has(pair) || !from || !to) continue;
			drawn.add(pair);
			const feet =
				a.altitude && other.altitude ? Math.abs(a.altitude.value - other.altitude.value) : null;
			features.push({
				type: 'Feature',
				geometry: {
					type: 'LineString',
					coordinates: [
						[from.lon, from.lat],
						[to.lon, to.lat]
					]
				},
				properties: {
					tier: x.tier,
					label: feet === null ? '' : `${Math.round(feet).toLocaleString('en')} ft`
				}
			});
		}
	}
	return { type: 'FeatureCollection', features };
}
