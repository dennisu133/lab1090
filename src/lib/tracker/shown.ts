/**
 * Where an aircraft is shown right now: the rule the map, the list and the panels share, so
 * an aircraft is on all of them or on none, at the same place.
 *
 * Dead reckoning: a position is up to half a second old when it arrives, and the next one
 * may be a few seconds away (missed messages). Drawn as is, planes would jump. So each one is
 * moved along from its last position with its ground speed and track, like a navigator
 * without GPS ("deduced reckoning"): distance = speed × time since the position. In a turn
 * it follows the arc at the measured turn rate (motion.ts). It's still a guess, so it stops
 * after EXTRAPOLATE_MS.
 *
 * Pure, no state.
 */
import type { LatLon } from '#lib/modes/cpr.ts';
import { KM_PER_NM } from '#lib/units.ts';
import { advance, headingReference, motion, trueHeading } from './motion';
import type { TrackedAircraft } from './tracker';

/** A position older than this isn't shown: the aircraft is out of reach, or stopped sending. */
export const SHOW_MS = 30_000;
/** Moved along for at most this long; then it waits where the guess ended. */
export const EXTRAPOLATE_MS = 15_000;

export interface Shown extends LatLon {
	/** ms since the last real position. */
	age: number;
	/** How far it was moved along, km (0: not at all). */
	extrapolatedKm: number;
	/** Where it points: the ground track (turned along in a turn), else see direction(). */
	track: number;
}

/**
 * The latest shownPosition() per snapshot (immutable, tracker.ts): the map's layers, the
 * list and the panels all ask for the same aircraft at the same time, 20 times a second.
 */
const lastShown = new WeakMap<TrackedAircraft, { now: number; shown: Shown | null }>();

/**
 * Where to show an aircraft now; null if not at all (no confirmed position, or too old).
 * Shared between callers: don't change it.
 */
export function shownPosition(a: TrackedAircraft, now: number): Shown | null {
	const last = lastShown.get(a);
	if (last?.now === now) return last.shown;
	const shown = shownAt(a, now);
	lastShown.set(a, { now, shown });
	return shown;
}

function shownAt(a: TrackedAircraft, now: number): Shown | null {
	const p = a.position;
	if (!p || !a.confirmed) return null;
	const age = Math.max(0, now - p.t);
	if (age > SHOW_MS) return null;
	// On the ground: no ADS-B velocity, and taxiing is too slow to matter.
	const m = motion(a);
	if (!m) return { lat: p.lat, lon: p.lon, age, extrapolatedKm: 0, track: direction(a, p) };
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
function direction(a: TrackedAircraft, at: LatLon): number {
	if (a.position?.surface) return a.surface?.value.direction ?? 0;
	if (a.ground) return a.ground.value.track;
	const heading = a.air?.value.heading;
	if (heading != null) return trueHeading(heading, headingReference(a), at, a.air!.t);
	return a.commB.trackAndTurn?.value.track ?? 0;
}
