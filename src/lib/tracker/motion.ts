/**
 * Where an aircraft goes next, from what it says about its motion now: the map uses it to
 * move symbols along between positions (dead reckoning, a few seconds) and to draw the
 * predicted path ahead of them (a minute or more), the panel to explain it.
 *
 * The model, and what it leaves out:
 *
 * - Sideways: the ground speed and track (TC 19), turning at the measured turn rate
 *   (tracker.ts, #turn). A turn ends at the autopilot's selected heading if the autopilot
 *   steers by heading (TC 29: autopilot on, not LNAV, not approach); then the track is
 *   compared with a heading, which is off by the drift angle (the wind's sideways push,
 *   a few degrees). Otherwise nobody tells us where the turn ends: in LNAV the flight
 *   management system flies a route we can't see. So the path stops after MAX_OPEN_TURN.
 *   No turn is predicted before it starts.
 * - Up and down: the vertical rate, levelling off at the selected altitude (TC 29) if
 *   that's the way it's going; level in altitude hold. Real aircraft round off the level-off
 *   over the last few hundred feet.
 * - The speed stays the same.
 *
 * Shared by server and browser; no state here.
 */
import { bearing, destination } from '#lib/geo.ts';
import { KM_PER_NM } from '#lib/units.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { decimalYear, magneticField } from '#lib/weather/wmm.ts';
import type { TrackedAircraft } from './tracker';

/** Below this, deg/s, the track counts as straight (in the capture, straight flight measures ≤ 0.04). */
export const TURNING = 0.2;
/** A turn whose end we don't know is followed this far, degrees; the path stops there. */
export const MAX_OPEN_TURN = 90;
/** A ground speed this much older than the position isn't used to move it along. */
const VELOCITY_MS = 10_000;
/** Autopilot settings (TC 29) and the vertical rate are used up to this old. */
const TARGET_MS = 30_000;
const VERTICAL_MS = 10_000;
/** Below this, ft/min, it counts as level (64 ft/min is the message's step). */
const LEVEL_FPM = 100;
/** Turns are followed in steps of this many seconds (each a short great-circle piece). */
const STEP_S = 1;

export interface Motion {
	/** Ground speed, kt. */
	speed: number;
	/** Ground track at `t`, degrees from true north. */
	track: number;
	/** deg/s, positive = right; 0 = straight. */
	turnRate: number;
	/** Where the turn ends: the selected heading (true), or null if unknown (or straight). */
	rollOut: number | null;
	/** Degrees left to turn before flying straight (Infinity: straight on, or open). */
	turnLeft: number;
	/** ft/min; 0 = level. */
	verticalRate: number;
	/** Where it levels off, ft (the selected altitude); null: it doesn't, or level already. */
	levelOff: number | null;
	/** Barometric altitude at `t`, ft; null if unknown. */
	altitude: number | null;
	/** When this motion was measured: the position's time. */
	t: number;
}

/** Headings in ADS-B: relative to true or magnetic north? null if not known (yet). */
export function headingReference(a: TrackedAircraft): 'true' | 'magnetic' | null {
	const op = a.operational?.value;
	if (!op) return null;
	// Versions 1 and 2 say which: HRD, ME bit 54 of TC 31 (DO-260A; DO-260B 2.2.3.2.7.2.13).
	// readsb (mode_s.c, track.c) and jet1090 (bds65.rs, AirborneV1) read it in both. Version 0
	// has no HRD: magnetic, as readsb assumes until a TC 31 says otherwise.
	return op.version >= 1 ? (op.hrd ?? 'magnetic') : 'magnetic';
}

/**
 * A heading relative to true north: magnetic + the declination at `at` (the World Magnetic
 * Model; about +5° in Germany now). If the reference is unknown, as given.
 */
export function trueHeading(
	heading: number,
	reference: 'true' | 'magnetic' | null,
	at: LatLon,
	t: number
): number {
	if (reference !== 'magnetic') return heading;
	const { declination } = magneticField(at.lat, at.lon, 0, decimalYear(t));
	return (heading + declination + 360) % 360;
}

/**
 * The motion at the latest position, or null if it can't be moved along: no confirmed
 * airborne position, or no ground velocity from around then. Aircraft that send only their
 * airspeed and heading (TC 19 subtypes 3/4) stay where they are: without the wind, those
 * don't say where it goes over the ground.
 */
export function motion(a: TrackedAircraft): Motion | null {
	const p = a.position;
	const g = a.ground;
	if (!p || p.surface || !g || p.t - g.t > VELOCITY_MS) return null;
	const t = p.t;

	const rate = a.turnRate && Math.abs(t - a.turnRate.t) <= VELOCITY_MS ? a.turnRate.value : 0;
	const turnRate = Math.abs(rate) >= TURNING ? rate : 0;
	const target = a.target && t - a.target.t <= TARGET_MS ? a.target.value : null;
	const m = target?.modes;
	let rollOut: number | null = null;
	let turnLeft = Infinity;
	if (turnRate && m?.autopilot && !m.lnav && !m.approach && target?.selectedHeading != null) {
		rollOut = trueHeading(target.selectedHeading, headingReference(a), p, t);
		const ahead = turnRate > 0 ? rollOut - g.value.track : g.value.track - rollOut;
		turnLeft = (ahead + 360) % 360;
		// Autopilots turn the short way: "more than half a circle to go" means it's already
		// there (the track is the heading plus the drift angle, so it may overshoot a little).
		if (turnLeft > 180) turnLeft = 0;
	}

	const vr = a.verticalRate && t - a.verticalRate.t <= VERTICAL_MS ? a.verticalRate.value.rate : 0;
	const verticalRate = m?.altitudeHold || Math.abs(vr) < LEVEL_FPM ? 0 : vr;
	const altitude = a.altitude
		? a.altitude.value + (verticalRate * (t - a.altitude.t)) / 60_000
		: null;
	const selected = target?.selectedAltitude?.feet ?? null;
	const levelOff =
		altitude !== null &&
		selected !== null &&
		((verticalRate > 0 && selected > altitude) || (verticalRate < 0 && selected < altitude))
			? selected
			: null;

	return {
		speed: g.value.speed,
		track: g.value.track,
		turnRate,
		rollOut,
		turnLeft,
		verticalRate,
		levelOff,
		altitude,
		t
	};
}

/** A point along the way. */
export interface Step extends LatLon {
	/** ms */
	t: number;
	track: number;
	altitude: number | null;
	/** Degrees turned since the start. */
	turned: number;
}

/** Where the motion leads `seconds` after its start. */
export function advance(start: LatLon, m: Motion, seconds: number): Step {
	let s: Step = { ...start, t: m.t, track: m.track, altitude: m.altitude, turned: 0 };
	if (m.turnRate === 0 || m.turnLeft === 0) {
		// Straight: one great-circle piece (no need for steps).
		const p = destination(start, m.track, km(m, seconds));
		const track = seconds > 0 ? finalBearing(start, p) : m.track;
		return { ...s, ...p, t: m.t + seconds * 1000, track, altitude: altitudeAt(m, seconds) };
	}
	for (let done = 0; done < seconds; done += STEP_S)
		s = step(s, m, Math.min(STEP_S, seconds - done));
	return s;
}

/**
 * The predicted path from `start` (where the symbol is now, `elapsed` s after the motion's
 * start), every `every` s up to `seconds` ahead. It stops early at the end of an open turn
 * (MAX_OPEN_TURN): beyond that we'd be guessing where the route goes.
 */
export function path(
	start: Step,
	m: Motion,
	seconds: number,
	every: number
): { points: Step[]; openTurnEnd: boolean } {
	const points = [start];
	let s = start;
	const open = m.turnRate !== 0 && m.rollOut === null;
	for (let ahead = 0; ahead < seconds;) {
		const dt = Math.min(every, seconds - ahead);
		for (let done = 0; done < dt; done += STEP_S) s = step(s, m, Math.min(STEP_S, dt - done));
		ahead += dt;
		points.push(s);
		if (open && s.turned >= MAX_OPEN_TURN) return { points, openTurnEnd: true };
	}
	return { points, openTurnEnd: false };
}

/**
 * dt seconds on: along the track at its middle (a chord of the arc), then the rest of the
 * turn. The track is relative to the local north, which turns as you go east or west (the
 * meridians meet at the poles): a great circle's bearing at its end differs from the one at
 * its start (0.1° per 10 km east at 52°N), so each piece continues from its end bearing.
 */
function step(s: Step, m: Motion, dt: number): Step {
	const limit = Math.min(m.turnLeft, m.rollOut === null ? MAX_OPEN_TURN : Infinity);
	const turn = m.turnRate === 0 ? 0 : Math.min(Math.abs(m.turnRate) * dt, limit - s.turned);
	const sign = Math.sign(m.turnRate);
	const p = destination(s, s.track + (sign * turn) / 2, km(m, dt));
	const elapsed = (s.t - m.t) / 1000 + dt;
	return {
		...p,
		t: s.t + dt * 1000,
		track: (finalBearing(s, p) + (sign * turn) / 2 + 360) % 360,
		altitude: altitudeAt(m, elapsed),
		turned: s.turned + Math.max(0, turn)
	};
}

/** The direction of travel on arriving at `to` along the great circle from `from`. */
function finalBearing(from: LatLon, to: LatLon): number {
	return (bearing(to, from) + 180) % 360;
}

function km(m: Motion, seconds: number): number {
	return (m.speed * KM_PER_NM * seconds) / 3600;
}

/** The altitude `seconds` after the start: climbing or descending, until the level-off. */
function altitudeAt(m: Motion, seconds: number): number | null {
	if (m.altitude === null) return null;
	const feet = m.altitude + (m.verticalRate * seconds) / 60;
	if (m.levelOff === null) return Math.max(0, feet);
	return m.verticalRate > 0 ? Math.min(feet, m.levelOff) : Math.max(feet, m.levelOff);
}
