import { describe, expect, test } from 'bun:test';
import { SampleClock } from './sample-clock';

const RATE = 2_400_000;
/** rtl_sdr's chunks: 256 KiB = 131,072 samples, 54.6 ms. */
const CHUNK = 131_072;

/** A tiny repeatable random number generator (mulberry32). */
function random(seed: number): () => number {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * `seconds` of chunks from a dongle whose crystal is `ppm` off, arriving 2–40 ms late.
 * `lose`: chunk numbers that never arrive; `stall`: [from, to] s during which everything
 * waits and then comes at once.
 */
function run(
	seconds: number,
	{ ppm = 0, lose = [] as number[], stall = null as [number, number] | null, seed = 1 } = {}
): SampleClock {
	const clock = new SampleClock(RATE);
	const next = random(seed);
	const chunkMs = ((CHUNK / RATE) * 1000) / (1 + ppm / 1e6);
	for (let k = 0; k * chunkMs < seconds * 1000; k++) {
		if (lose.includes(k)) continue;
		const ready = (k + 1) * chunkMs;
		let at = ready + 2 + next() ** 3 * 38;
		if (stall && ready >= stall[0] * 1000 && ready < stall[1] * 1000) at = stall[1] * 1000 + 1;
		clock.add(CHUNK, at);
	}
	return clock;
}

describe('SampleClock', () => {
	test('measures the crystal from the arrival times, despite their jitter', () => {
		for (const ppm of [-40, 0, 25]) {
			const report = run(600, { ppm }).report(600_000);
			expect(report.ppm!).toBeCloseTo(ppm, 0);
			expect(report.ppmError!).toBeLessThan(0.5);
			expect(report.gaps).toBe(0);
		}
	});

	test('counts a lost buffer as a step, and the slope stays right', () => {
		const report = run(600, { ppm: 25, lose: [3000, 7000] }).report(600_000);
		expect(report.gaps).toBe(2);
		expect(report.lostMs).toBeCloseTo((2 * CHUNK * 1000) / RATE, -1);
		expect(report.ppm!).toBeCloseTo(25, 0);
	});

	test('a stall where everything arrives late is not a loss', () => {
		const report = run(600, { ppm: 10, stall: [300, 300.6] }).report(600_000);
		expect(report.gaps).toBe(0);
		expect(report.lostMs).toBe(0);
		expect(report.ppm!).toBeCloseTo(10, 0);
	});

	test('says nothing about the crystal before it has a few windows', () => {
		expect(run(30).report(30_000).ppm).toBeNull();
		expect(new SampleClock(RATE).report(0).seconds).toBe(0);
	});
});
