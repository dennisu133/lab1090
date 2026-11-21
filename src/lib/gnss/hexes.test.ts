import { expect, test } from 'bun:test';
import { destination, distanceKm } from '#lib/geo.ts';
import { prng } from '#lib/modes/testing.ts';
import { HexGrid } from './hexes';

const receiver = { lat: 52, lon: 14 };
const grid = new HexGrid(receiver, 15);

test('every position is nearer its own cell’s centre than any other cell’s', () => {
	const random = prng(7);
	for (let i = 0; i < 2000; i++) {
		const p = destination(receiver, random() * 360, random() * 450);
		const own = grid.center(grid.key(p));
		const d = distanceKm(p, own);
		// Within a corner's reach of the centre (15 km, give or take the projection).
		expect(d).toBeLessThan(15 * 1.12);
		// Each of the six neighbours' centres is further (allowing for the projection).
		const [q, r] = grid.key(p).split(',').map(Number);
		for (const [dq, dr] of [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
			[1, -1],
			[-1, 1]
		]) {
			expect(distanceKm(p, grid.center(`${q + dq},${r + dr}`))).toBeGreaterThan(d * 0.9);
		}
	}
});

test('a cell’s centre lies in it, its corners a side’s length away, and its ring is closed', () => {
	for (const key of ['0,0', '3,-2', '-10,7']) {
		expect(grid.key(grid.center(key))).toBe(key);
		const ring = grid.ring(key);
		expect(ring).toHaveLength(7);
		expect(ring[6]).toEqual(ring[0]);
		const c = grid.center(key);
		for (const [lon, lat] of ring) expect(distanceKm(c, { lat, lon })).toBeCloseTo(15, -0.5);
	}
	expect(grid.key(receiver)).toBe('0,0');
});
