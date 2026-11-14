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
 * Immutable: every change returns new arrays (the snapshots in tracker.ts share them).
 */

export interface TrailPoint {
	lat: number;
	lon: number;
	/** Barometric altitude, ft (for the colour); null if unknown or on the ground. */
	altitude: number | null;
	/** From a surface position: on the ground. */
	ground: boolean;
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

/** Drop points older than TRAIL_MS, and segments left empty. Returns the same trail if nothing changed. */
export function prune(trail: Trail, now: number): Trail {
	const from = now - TRAIL_MS;
	if (!trail.length || trail[0][0].t >= from) return trail;
	return trail.map((s) => s.filter((p) => p.t >= from)).filter((s) => s.length > 0);
}
