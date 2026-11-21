/**
 * Where an aircraft has been: the line behind it on the map.
 *
 * Positions arrive about twice a second; keeping every one would be 1,200 points per
 * aircraft in 10 minutes, for a line that looks the same with far fewer. So a point is kept
 * every STEP_MS (at 450 kt that's every 0.5 NM; in a standard-rate turn of 3°/s, a 12°
 * bend per point). The last point always follows the aircraft, so the line ends at the
 * plane, not up to STEP_MS behind it.
 *
 * A trail is a list of segments: after a gap without positions (out of range behind a
 * building, or a restart in positions.ts) a new segment starts, so the map doesn't draw a
 * straight line across a stretch nobody saw.
 *
 * Unless the aircraft shows it flew straight across (`bridges`). Airliners in cruise follow
 * a straight route for many minutes, and most gaps are a few dozen messages the antenna
 * missed. The check: the straight line from the last position before the gap to the first
 * after, divided by the gap's time, is a speed. Any detour (a turn and back, an S, a hold)
 * makes the path longer than that line, so the aircraft would have had to fly faster than
 * the line's speed. If the line's speed is the ground speed reported before and after,
 * there was no time for a detour: a path 3 % longer than the line is at most 12 % of its
 * length away from it. And if the line also points along the reported track at both ends,
 * much less. Ground speed and track are the aircraft's own, from its airborne velocity
 * messages (TC 19, subtypes 1 and 2: modes/velocity.ts). The map draws a bridge fainter
 * than the trail: nobody heard the aircraft there.
 *
 * In an hour of traffic (fixtures/local/capture-1h.beast) 56 of 70 gaps got a bridge, most
 * with the line's speed within 2 % of the reported ones, all within 3° of the tracks; the
 * furthest off in speed were aircraft climbing (and speeding up) through the gap. Two had
 * turned in the gap, by 16° and 8°: no bridge. The other 12 had no velocity reported on
 * one side, most of them heard once more after the gap and then lost. An aircraft not
 * heard at all for a minute is dropped, trail and all (tracker.ts AIRCRAFT_TTL_MS): it
 * comes back as a new one, with nothing to bridge to.
 *
 * Immutable: every change returns new arrays (the snapshots in tracker.ts share them).
 */

import { bearing, distanceKm } from '#lib/geo.ts';
import { KM_PER_NM } from '#lib/units.ts';

export interface TrailPoint {
	lat: number;
	lon: number;
	/** Barometric altitude, ft (for the colour); null if unknown or on the ground. */
	altitude: number | null;
	/** From a surface position: on the ground. */
	ground: boolean;
	/**
	 * The latest ground speed (kt) and track (° true) the aircraft reported, and when (ms):
	 * at most VELOCITY_MS before.
	 */
	velocity: { speed: number; track: number; t: number } | null;
	/** When, ms. */
	t: number;
}

export type Trail = readonly (readonly TrailPoint[])[];

/** One point kept per this many ms. */
export const STEP_MS = 4_000;
/** A gap this long starts a new segment. */
export const GAP_MS = 30_000;
/** How much of the trail is kept. */
export const TRAIL_MS = 10 * 60_000;

/** Add the aircraft's newest position. `restart`: start a new segment, whatever the gap. */
export function extend(trail: Trail, point: TrailPoint, restart = false): Trail {
	const segment = trail.at(-1);
	const head = segment?.at(-1);
	if (!segment || !head || restart || point.t - head.t > GAP_MS) return [...trail, [point]];
	// The head moves along until it's STEP_MS past the point before it; then it stays.
	const before = segment.at(-2);
	const updated =
		before && head.t - before.t < STEP_MS ? [...segment.slice(0, -1), point] : [...segment, point];
	return [...trail.slice(0, -1), updated];
}

/**
 * The trail's newest point while it still moves along: the next position takes its place
 * (extend), until it's STEP_MS past the point before it. null: the newest point stays.
 */
export function movingHead(trail: Trail): TrailPoint | null {
	const segment = trail.at(-1);
	const head = segment?.at(-1);
	const before = segment?.at(-2);
	return head && before && head.t - before.t < STEP_MS ? head : null;
}

/** Drop points older than TRAIL_MS, and segments left empty. Returns the same trail if nothing changed. */
export function prune(trail: Trail, now: number): Trail {
	const from = now - TRAIL_MS;
	if (!trail.length || trail[0][0].t >= from) return trail;
	return trail.map((s) => s.filter((p) => p.t >= from)).filter((s) => s.length > 0);
}

/**
 * A reported velocity this old still counts for a trail point, and one this long after a gap
 * for its far end. An old one can't make a wrong bridge: if the aircraft turned since, the
 * line across doesn't point along it.
 */
export const VELOCITY_MS = 60_000;
/**
 * The speed across a gap may be this much (a fraction) below the slowest reported either
 * side: a detour makes it slower, and this limits how long the path can have been (see the
 * top).
 */
export const SLOWER_TOLERANCE = 0.03;
/**
 * …and this much above the fastest. No detour makes it faster, so this is only for speed
 * changes (a climbing aircraft speeds up, and the wind changes with height) and timing.
 */
export const FASTER_TOLERANCE = 0.06;
/** The line across a gap may point this far off the track reported at either end, degrees. */
export const TRACK_TOLERANCE_DEG = 5;

/** How far apart two directions are, 0–180°. */
const turn = (a: number, b: number) => Math.abs(((b - a + 540) % 360) - 180);

/**
 * The gaps a straight line bridges (see the top): pairs of the last point before a gap and
 * the first after. Airborne only (taxiing turns all the time). The velocity after the gap
 * must have been reported after it began (the first point after a short gap can still
 * carry the one from before), and may come with a later point: positions and velocities
 * are separate messages, and the first position after a gap can come before the first
 * velocity.
 */
export function bridges(trail: Trail): [TrailPoint, TrailPoint][] {
	const found: [TrailPoint, TrailPoint][] = [];
	for (let i = 1; i < trail.length; i++) {
		const from = trail[i - 1].at(-1)!;
		const to = trail[i][0];
		const before = from.velocity;
		const after = trail[i].find(
			(p) => p.velocity && p.velocity.t > from.t && p.t - to.t <= VELOCITY_MS
		)?.velocity;
		if (from.ground || to.ground || !before || !after || to.t <= from.t) continue;
		const speed = distanceKm(from, to) / KM_PER_NM / ((to.t - from.t) / 3_600_000);
		const slowest = Math.min(before.speed, after.speed) * (1 - SLOWER_TOLERANCE);
		const fastest = Math.max(before.speed, after.speed) * (1 + FASTER_TOLERANCE);
		if (speed < slowest || speed > fastest) continue;
		// A great circle's direction changes along it: compare each end with its own.
		if (turn(before.track, bearing(from, to)) > TRACK_TOLERANCE_DEG) continue;
		if (turn(after.track, (bearing(to, from) + 180) % 360) > TRACK_TOLERANCE_DEG) continue;
		found.push([from, to]);
	}
	return found;
}
