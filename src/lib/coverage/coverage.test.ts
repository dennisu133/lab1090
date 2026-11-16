import { describe, expect, test } from 'bun:test';
import { destination } from '#lib/geo.ts';
import { Coverage, MAX_POINTS, SECTOR_DEG, sectorOf, summarize, THIN_MS } from './coverage';
import { aircraftElevation, radioHorizon } from './geometry';
import { terrainSkyline } from './terrain';

const RECEIVER = { lat: 52, lon: 14 };
const at = (bearing: number, km: number) => destination(RECEIVER, bearing, km);

describe('Coverage', () => {
	test('keeps the lowest elevation and the farthest position per band, per sector', () => {
		const c = new Coverage(RECEIVER);
		c.add('A', 0, at(272, 190), 35_000); // low in the sky, far
		c.add('B', 1, at(273, 60), 37_000); // high up, nearer
		c.add('C', 2, at(271, 60), 15_000); // another band, 4° up
		c.add('D', 3, at(32, 30), 38_000); // north-east: only high up
		const sectors = c.sectors();
		const west = sectors[sectorOf(272)];
		expect(west.positions).toBe(3);
		expect(west.aircraft).toBe(3);
		expect(west.lowest!.icao).toBe('A');
		expect(west.lowest!.elevation).toBeCloseTo(aircraftElevation(190, 35_000), 1);
		expect(west.farthest.map((p) => p?.icao ?? null)).toEqual([null, 'C', null, 'A']);
		expect(sectors[sectorOf(32)].lowest!.elevation).toBeGreaterThan(20);
		expect(sectors[sectorOf(120)].lowest).toBeNull();
		expect(sectors).toHaveLength(360 / SECTOR_DEG);
	});

	test('thins the plot to one point per aircraft per THIN_MS, but keeps every new extreme', () => {
		const c = new Coverage(RECEIVER);
		// Flying straight away to the west, one position a second: every one a new farthest.
		for (let s = 0; s < 30; s++) c.add('A', s * 1000, at(272, 100 + s * 0.25), 35_000);
		expect(c.points()).toHaveLength(30);
		// Coming towards the receiver: nothing new beyond the first.
		const d = new Coverage(RECEIVER);
		for (let s = 0; s < 30; s++) d.add('A', s * 1000, at(272, 100 - s * 0.25), 35_000);
		expect(d.points()).toHaveLength(Math.ceil(30_000 / THIN_MS));
		expect(d.positions).toBe(30);
	});

	test('keeps at most MAX_POINTS for the plot, the newest', () => {
		const c = new Coverage(RECEIVER);
		for (let i = 0; i < MAX_POINTS + 5; i++) c.add(`A${i}`, i, at(270, 50), 30_000);
		expect(c.points()).toHaveLength(MAX_POINTS);
		expect(c.points()[0].icao).toBe('A5');
	});

	test('a higher antenna lowers every angle', () => {
		const c = new Coverage(RECEIVER);
		c.add('A', 0, at(270, 30), 1_000);
		const before = c.sectors()[sectorOf(270)].lowest!.elevation;
		c.setAntenna(0.1);
		const after = c.sectors()[sectorOf(270)].lowest!.elevation;
		expect(after).toBeCloseTo(aircraftElevation(30, 1_000, 0.1), 6);
		expect(before - after).toBeCloseTo(0.19, 2); // atan(0.1 / 30)
	});
});

describe('terrain skyline', () => {
	test('flat land at the antenna height: just below 0° everywhere', () => {
		const sky = terrainSkyline(RECEIVER, 0.05, () => 50);
		expect(sky).toHaveLength(360);
		// The nearest point traced (200 m) is the highest-looking one over a flat Earth.
		for (const a of sky) expect(a).toBeCloseTo(-(0.2 / (2 * 8494.67)) * (180 / Math.PI), 4);
	});

	test('a ridge 300 m high, 10 km to the east, shows up there and nowhere else', () => {
		const ridge = (p: { lat: number; lon: number }) =>
			p.lon > 14.146 && p.lon < 14.16 && Math.abs(p.lat - 52) < 0.2 ? 350 : 50;
		const sky = terrainSkyline(RECEIVER, 0.06, ridge);
		// atan((0.35 − 0.06 − ~0.006) / ~10) ≈ 1.6°.
		expect(sky[90]).toBeGreaterThan(1.4);
		expect(sky[90]).toBeLessThan(1.8);
		expect(sky[270]).toBeLessThan(0);
		expect(sky[0]).toBeLessThan(0);
	});
});

describe('summarize', () => {
	test('open arcs, also across north, and the farthest against its horizon', () => {
		const c = new Coverage(RECEIVER);
		// Open (low in the sky) from 340° round to 20°, and at 200–210°; high only at 90°.
		for (let b = 341; b < 380; b += 5) c.add(`N${b}`, 0, at(b % 360, 150), 35_000);
		c.add('S1', 0, at(201, 190), 35_000);
		c.add('S2', 0, at(206, 180), 35_000);
		c.add('E', 0, at(92, 20), 38_000);
		const s = summarize(c.sectors(), (ft) => radioHorizon(ft));
		expect(s.open).toEqual([
			{ from: 340, width: 40 },
			{ from: 200, width: 10 }
		]);
		expect(s.heard).toBe(11);
		expect(s.farthest!.point.icao).toBe('S1');
		expect(s.farthest!.ofHorizon).toBeCloseTo(190 / radioHorizon(35_000), 6);
	});

	test('nothing yet', () => {
		const s = summarize(new Coverage(RECEIVER).sectors(), radioHorizon);
		expect(s).toEqual({ farthest: null, heard: 0, open: [] });
	});
});
