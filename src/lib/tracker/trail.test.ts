import { describe, expect, test } from 'bun:test';
import { destination } from '#lib/geo.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { KM_PER_NM } from '#lib/units.ts';
import {
	bridges,
	extend,
	FASTER_TOLERANCE,
	GAP_MS,
	prune,
	SLOWER_TOLERANCE,
	STEP_MS,
	TRAIL_MS,
	type Trail,
	type TrailPoint
} from './trail';

const at = (t: number): TrailPoint => ({
	lat: 52 + t / 1e7,
	lon: 14,
	altitude: 35_000,
	ground: false,
	velocity: null,
	t
});

/** Positions every 500 ms from `from` to `to`. */
function track(trail: Trail, from: number, to: number): Trail {
	for (let t = from; t <= to; t += 500) trail = extend(trail, at(t));
	return trail;
}

describe('trails', () => {
	test(`a point every ${STEP_MS / 1000} s, and the last one at the aircraft`, () => {
		const trail = track([], 0, 10_000);
		expect(trail.length).toBe(1);
		expect(trail[0].map((p) => p.t)).toEqual([0, 4000, 8000, 10_000]);
	});

	test(`a gap of more than ${GAP_MS / 1000} s starts a new segment; so does a restart`, () => {
		let trail = track([], 0, 2000);
		trail = track(trail, 2000 + GAP_MS + 500, 2000 + GAP_MS + 1000);
		expect(trail.map((s) => s.length)).toEqual([2, 2]);
		trail = extend(trail, at(40_000), true);
		expect(trail.map((s) => s.length)).toEqual([2, 2, 1]);
	});

	test('immutable: an old snapshot keeps its points', () => {
		const before = track([], 0, 1000);
		const after = extend(before, at(1500));
		expect(before[0].map((p) => p.t)).toEqual([0, 1000]);
		expect(after[0].map((p) => p.t)).toEqual([0, 1500]);
	});

	test(`keeps ${TRAIL_MS / 60_000} minutes, and drops empty segments`, () => {
		let trail = track([], 0, 4000);
		trail = extend(trail, at(60_000), true);
		trail = track(trail, 60_000, TRAIL_MS + 10_000);
		const pruned = prune(trail, TRAIL_MS + 10_000);
		expect(pruned.length).toBe(1);
		expect(pruned[0][0].t).toBeGreaterThanOrEqual(10_000);
		expect(prune(pruned, TRAIL_MS + 10_000)).toBe(pruned); // nothing to drop: same object
	});
});

describe('bridges across gaps', () => {
	const KT = 450;
	const km = (ms: number, kt = KT) => (kt * KM_PER_NM * ms) / 3_600_000;
	const start = { lat: 52, lon: 14 };

	/** Flying `track` at `kt` from `from` (at time `t0`) to `t1`, reporting its velocity. */
	function fly(trail: Trail, from: LatLon, track: number, t0: number, t1: number, kt = KT) {
		for (let t = t0; t <= t1; t += 500) {
			const p = destination(from, track, km(t - t0, kt));
			const velocity = { speed: kt, track, t };
			trail = extend(trail, { ...p, altitude: 35_000, ground: false, velocity, t });
		}
		return trail;
	}

	// North for 10 s, then a minute nobody hears.
	const before = fly([], start, 0, 0, 10_000);
	const lost = destination(start, 0, km(10_000));
	const found = (d: number) => destination(lost, 0, d);

	test('straight on at the reported speed: bridged', () => {
		const trail = fly(before, found(km(60_000)), 0, 70_000, 75_000);
		expect(trail.length).toBe(2);
		expect(bridges(trail).map(([a, b]) => [a.t, b.t])).toEqual([[10_000, 70_000]]);
	});

	test('turned in the gap: open', () => {
		// 30 s on, then 30 s at 15°: the line across points 7.5° off both tracks.
		const turned = destination(found(km(30_000)), 15, km(30_000));
		expect(bridges(fly(before, turned, 15, 70_000, 75_000))).toEqual([]);
	});

	test(`a detour (the line's speed more than ${SLOWER_TOLERANCE * 100} % slow): open`, () => {
		// Straight on, but 10 % short of where the ground speed would have taken it.
		expect(bridges(fly(before, found(km(54_000)), 0, 70_000, 75_000))).toEqual([]);
		expect(bridges(fly(before, found(km(59_000)), 0, 70_000, 75_000)).length).toBe(1);
	});

	test(`faster: up to ${FASTER_TOLERANCE * 100} % (speeding up in a climb)`, () => {
		expect(bridges(fly(before, found(km(63_000)), 0, 70_000, 75_000)).length).toBe(1);
		expect(bridges(fly(before, found(km(66_000)), 0, 70_000, 75_000))).toEqual([]);
	});

	test('the velocity after the gap must be reported after it began', () => {
		// The first positions after the gap still carry the velocity from before it.
		const old = before.at(-1)!.at(-1)!.velocity;
		const p = (t: number): TrailPoint => ({
			...found(km(t - 10_000)),
			altitude: 35_000,
			ground: false,
			velocity: old,
			t
		});
		let trail = extend(extend(before, p(70_000)), p(70_500));
		expect(bridges(trail)).toEqual([]);
		trail = extend(trail, { ...p(71_000), velocity: { speed: KT, track: 0, t: 70_800 } });
		expect(bridges(trail).length).toBe(1);
	});

	test('not on the ground, nor without velocities', () => {
		const after = fly(before, found(km(60_000)), 0, 70_000, 75_000);
		const change = (f: (p: TrailPoint) => TrailPoint) => after.map((s) => s.map(f));
		expect(bridges(change((p) => ({ ...p, ground: true })))).toEqual([]);
		expect(bridges(change((p) => ({ ...p, velocity: null })))).toEqual([]);
	});
});
