import { describe, expect, test } from 'bun:test';
import type { CoveragePoint } from '#lib/coverage/coverage.ts';
import { PointUpdates } from './coverage';

const point = (t: number): CoveragePoint => ({
	icao: 'ABC123',
	t,
	lat: 52,
	lon: 14 + t / 1000,
	altitude: 35_000,
	distance: 10,
	bearing: 90,
	elevation: 1
});

describe('coverage points on the map', () => {
	test('only the points added at the end and dropped at the start go, by id', () => {
		const [a, b, c, d] = [0, 1, 2, 3].map(point);
		const updates = new PointUpdates();
		const first = updates.next([a, b, c])!;
		expect(first.removeAll).toBe(true);
		expect(first.add.map((f) => [f.id, f.geometry.coordinates[0]])).toEqual([
			[0, 14],
			[1, 14.001],
			[2, 14.002]
		]);
		expect(updates.next([a, b, c])).toBeNull();
		// The oldest gone (MAX_POINTS), one new.
		const next = updates.next([b, c, d])!;
		expect(next.remove).toEqual([0]);
		expect(next.add.map((f) => f.id)).toEqual([3]);
		expect(next.removeAll).toBeUndefined();
		// New objects for the same positions (the antenna height came in): all again.
		const again = updates.next([b, c, d].map((p) => ({ ...p })))!;
		expect(again.removeAll).toBe(true);
		expect(again.add.map((f) => f.id)).toEqual([4, 5, 6]);
		// Emptied (a new server run): everything goes.
		expect(updates.next([])).toEqual({ add: [], remove: [4, 5, 6] });
	});
});
