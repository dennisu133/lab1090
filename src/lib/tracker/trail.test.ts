import { describe, expect, test } from 'bun:test';
import { extend, GAP_MS, prune, STEP_MS, TRAIL_MS, type Trail, type TrailPoint } from './trail';

const at = (t: number): TrailPoint => ({
	lat: 52 + t / 1e7,
	lon: 14,
	altitude: 35_000,
	ground: false,
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
