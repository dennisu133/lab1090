import { expect, test } from 'bun:test';
import { destination } from '#lib/geo.ts';
import type { Change } from '#lib/gnss/watch.ts';
import { changeFeatures } from './gnss.ts';

const start = { lat: 52, lon: 14 };
const change = (id: number, kind: Change['kind'], km: number, s: number): Change => ({
	id,
	icao: 'AAAAAA',
	callsign: null,
	kind,
	other: 'none',
	t: s * 1000,
	at: destination(start, 90, km),
	atT: s * 1000,
	altitude: 36000,
	gap: 500
});

test('a loss to TC 0 and its regaining are joined, if the aircraft could have flown it', () => {
	// 100 km in 7 min: 460 kt.
	const flown = changeFeatures([change(1, 'lost', 0, 0), change(2, 'regained', 100, 420)], 2);
	expect(flown.points.features.map((f) => f.properties)).toEqual([
		{ id: 1, kind: 'lost', selected: false },
		{ id: 2, kind: 'regained', selected: true }
	]);
	expect(flown.blind.features).toHaveLength(1);
	// 100 km in 1 min: 3,200 kt, a jump (a replay starting over), not a flight.
	const jumped = changeFeatures([change(1, 'lost', 0, 0), change(2, 'regained', 100, 60)], null);
	expect(jumped.blind.features).toEqual([]);
});
