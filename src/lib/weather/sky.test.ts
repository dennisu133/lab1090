import { describe, expect, test } from 'bun:test';
import { SAMPLE_EVERY_MS, Sky, WINDOW_MS, qnh, type SettingSample } from './sky';

const setting = (icao: string, rx: number, hPa: number): SettingSample => ({
	icao,
	rx,
	hPa,
	altitude: 3000,
	from: '4,0'
});

describe('qnh', () => {
	test('the median of local settings; standard ones (within 0.5 hPa) only counted', () => {
		const q = qnh([
			setting('A', 1, 1021),
			setting('B', 2, 1022),
			setting('C', 3, 1013.2), // standard, 4,0's 0.1 hPa steps
			setting('D', 4, 1012.8), // standard, TC 29's 0.8 hPa steps
			setting('E', 5, 1020)
		]);
		expect(q.hPa).toBe(1021);
		expect(q.local.map((s) => s.icao)).toEqual(['E', 'B', 'A']); // newest first
		expect(q.standard).toBe(2);
	});

	test("each aircraft's latest setting counts: switching to standard after take-off", () => {
		const q = qnh([setting('A', 1, 1021), setting('B', 2, 1019), setting('A', 3, 1013.2)]);
		expect(q.hPa).toBe(1019);
		expect(q.standard).toBe(1);
	});

	test('an even number of settings: the mean of the middle two', () => {
		expect(qnh([setting('A', 1, 1018), setting('B', 2, 1021)]).hPa).toBe(1019.5);
	});

	test('nothing local: standard', () => {
		expect(qnh([]).hPa).toBe(1013.25);
	});
});

describe('Sky', () => {
	const position = { lat: 52, lon: 14, from: 'ADS-B' as const };

	test('one sample per aircraft and kind every SAMPLE_EVERY_MS', () => {
		const sky = new Sky();
		for (let rx = 0; rx < 3 * SAMPLE_EVERY_MS; rx += 500) {
			sky.addColumn('A', rx, 35_000, -700, position);
			sky.addColumn('B', rx, 37_000, -650, position);
		}
		expect(sky.samples.columns.filter((c) => c.icao === 'A').map((c) => c.rx)).toEqual([
			0,
			SAMPLE_EVERY_MS,
			2 * SAMPLE_EVERY_MS
		]);
		expect(sky.samples.columns).toHaveLength(6);
	});

	test('looks up the geoid where the aircraft is', () => {
		const sky = new Sky();
		sky.addColumn('A', 0, 35_000, -700, position);
		expect(sky.samples.columns[0].geoid).toBeCloseTo(40, -1);
	});

	test('forgets samples older than the window; unchanged arrays stay the same object', () => {
		const sky = new Sky();
		sky.addColumn('A', 0, 35_000, -700, position);
		sky.addSetting(setting('A', 0, 1020));
		sky.addColumn('A', WINDOW_MS, 35_000, -700, position);
		const before = sky.samples;
		sky.prune(WINDOW_MS);
		expect(sky.samples).toBe(before);
		sky.prune(WINDOW_MS + 1);
		expect(sky.samples.columns.map((c) => c.rx)).toEqual([WINDOW_MS]);
		expect(sky.samples.settings).toEqual([]);
	});

	test('samples once read never change; a kind without new samples keeps its array', () => {
		const sky = new Sky();
		sky.addColumn('A', 0, 35_000, -700, position);
		sky.addSetting(setting('A', 0, 1020));
		const first = sky.samples;
		sky.addColumn('B', 0, 37_000, -650, position);
		sky.addColumn('C', 0, 36_000, -600, position);
		const second = sky.samples;
		expect(first.columns.map((c) => c.icao)).toEqual(['A']);
		expect(second.columns.map((c) => c.icao)).toEqual(['A', 'B', 'C']);
		expect(second.settings).toBe(first.settings);
		sky.addColumn('D', 0, 38_000, -550, position);
		expect(second.columns).toHaveLength(3);
	});
});
