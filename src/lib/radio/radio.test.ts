import { describe, expect, test } from 'bun:test';
import type { RadioPoint } from '#lib/receiver-types.ts';
import { summarize } from './history';
import { freeSpace, freeSpaceLevel } from './path-loss';

const point = (t: number, p: Partial<RadioPoint> = {}): RadioPoint => ({
	t,
	ms: 10_000,
	messages: 500,
	noise: -40,
	candidates: 30_000,
	demodulated: 450,
	clipped: 2,
	busyMs: 700,
	samples: 24e6,
	...p
});

describe('summarize', () => {
	test('adds up the points after a time', () => {
		const s = summarize([point(10_000), point(20_000, { noise: -20 }), point(30_000)], 10_000);
		expect(s).toMatchObject({ seconds: 20, messages: 1000, demodulated: 900, clipped: 4 });
		expect(s.busyShare).toBeCloseTo(0.07, 5);
		// −40 and −20 dBFS averaged as amplitudes (0.01 and 0.1), not as dB.
		expect(s.noise!).toBeCloseTo(20 * Math.log10(0.055), 5);
	});

	test('a Beast feed: messages only', () => {
		const beast = {
			noise: null,
			candidates: null,
			demodulated: null,
			clipped: null,
			busyMs: null,
			samples: null
		};
		const s = summarize([point(1, beast)], 0);
		expect(s).toEqual({
			seconds: 10,
			messages: 500,
			candidates: null,
			demodulated: null,
			clipped: null,
			noise: null,
			busyShare: null
		});
	});
});

describe('free-space line', () => {
	test('20 dB weaker for ten times the distance, level from the median', () => {
		const at = (km: number, dbfs: number) => ({ t: 0, icao: 'A', km, dbfs, elevation: null });
		const points = [at(10, -10), at(100, -30), at(100, -45), at(50, -24)];
		expect(freeSpaceLevel(points)).toBeCloseTo(10, 0);
		expect(freeSpace(10, 100)).toBe(-30);
		expect(freeSpaceLevel([])).toBeNull();
	});
});
