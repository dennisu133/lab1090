import { describe, expect, test } from 'bun:test';
import { isaTemperature } from '#lib/modes/air-data.ts';
import {
	JET_KT,
	MIN_SAMPLES,
	enough,
	lapseRate,
	layers,
	strongestWind,
	tropopause,
	type TemperatureSample,
	type WindSample
} from './profile';
import { toVector } from './wind';

/** MIN_SAMPLES temperatures at each level, from a temperature profile (K). */
function sounding(levels: number[], kelvin: (feet: number) => number): TemperatureSample[] {
	return levels.flatMap((altitude) =>
		Array.from({ length: MIN_SAMPLES }, (_, i) => ({
			icao: `A${i}`,
			rx: 0,
			altitude,
			kelvin: kelvin(altitude)
		}))
	);
}

const range = (from: number, to: number) =>
	Array.from({ length: (to - from) / 1000 + 1 }, (_, i) => from + i * 1000);

describe('layers', () => {
	test('samples go into the nearest 1,000 ft layer, with counts and averages', () => {
		const [l] = layers(
			[
				{ icao: 'A', rx: 0, altitude: 36_975, kelvin: 216 },
				{ icao: 'A', rx: 0, altitude: 37_025, kelvin: 218 },
				{ icao: 'B', rx: 0, altitude: 37_400, kelvin: 220 }
			],
			[],
			[]
		);
		expect(l.level).toBe(37_000);
		expect(l.temperature!.n).toBe(3);
		expect(l.temperature!.aircraft).toBe(2);
		expect(l.temperature!.kelvin).toBe(218);
		expect(l.temperature!.spread).toBeCloseTo(1.633, 3);
		// ISA is −56.5 °C (216.65 K) at all three altitudes.
		expect(l.temperature!.isaDeviation).toBeCloseTo(218 - 216.65, 6);
	});

	test('winds are averaged as vectors: 350° and 010° make 360°, not 180°', () => {
		const winds: WindSample[] = [350, 10].map((from, i) => ({
			icao: `A${i}`,
			rx: 0,
			altitude: 35_000,
			wind: toVector(50, from + 180), // vectors point where the air goes
			air: toVector(450, 0),
			from: '5,0/6,0' as const,
			at: null
		}));
		const w = layers([], winds, [])[0].wind!;
		expect(Math.round(w.wind.direction) % 360).toBe(0);
		expect(w.wind.speed).toBeCloseTo(50 * Math.cos((10 * Math.PI) / 180), 6);
		expect(w.steadiness).toBeCloseTo(0.985, 3);
	});

	test('lowest layer first; a layer can have some kinds and not others', () => {
		const ls = layers(
			[{ icao: 'A', rx: 0, altitude: 38_000, kelvin: 216 }],
			[],
			[
				{
					icao: 'B',
					rx: 0,
					altitude: 30_000,
					gnssMinusBaro: -500,
					geoid: 40,
					position: { lat: 52, lon: 14, from: 'ADS-B' }
				}
			]
		);
		expect(ls.map((l) => l.level)).toEqual([30_000, 38_000]);
		expect(ls[0].temperature).toBeNull();
		expect(ls[0].column!.gnssMinusBaro).toBe(-500);
	});
});

describe('tropopause (WMO: lapse rate ≤ 2 K/km, staying so on average for 2 km)', () => {
	test('lapse rate: K per km, positive when it gets colder going up', () => {
		// The ISA troposphere: 6.5 K/km.
		const at = (level: number) => ({ level, kelvin: isaTemperature(level) });
		expect(lapseRate(at(10_000), at(20_000))).toBeCloseTo(6.5, 6);
	});

	test('the standard atmosphere: in the layer that holds 36,089 ft', () => {
		const t = tropopause(layers(sounding(range(25_000, 43_000), isaTemperature), [], []));
		expect(t).toMatchObject({ found: true, level: 36_000, atOrBelow: false });
	});

	test('a low tropopause in cold air: isothermal from FL280', () => {
		const kelvin = (ft: number) => isaTemperature(Math.min(ft, 28_000)) - 5;
		const t = tropopause(layers(sounding(range(20_000, 40_000), kelvin), [], []));
		expect(t).toMatchObject({ found: true, level: 28_000 });
	});

	test('a short pause in the cooling is not a tropopause: the 2 km check', () => {
		// Isothermal from 20,000 to 22,000 ft (an inversion-like step), then cooling again.
		const kelvin = (ft: number) =>
			isaTemperature(ft < 20_000 ? ft : ft < 22_000 ? 20_000 : ft - 2_000);
		const t = tropopause(layers(sounding(range(15_000, 34_000), kelvin), [], []));
		expect(t.found).toBe(false);
	});

	test('only cruise data, already isothermal: "at or below" the lowest layer', () => {
		const t = tropopause(
			layers(
				sounding(range(37_000, 41_000), () => 216.65),
				[],
				[]
			)
		);
		expect(t).toMatchObject({ found: true, level: 37_000, atOrBelow: true });
	});

	test('only tropospheric data: not found, the tropopause is higher', () => {
		const t = tropopause(layers(sounding(range(5_000, 20_000), isaTemperature), [], []));
		expect(t.found).toBe(false);
		if (!t.found) expect(t.reason).toContain('higher');
	});

	test('not enough above a qualifying layer to check the next 2 km', () => {
		const t = tropopause(layers(sounding([30_000, 36_000, 37_000], isaTemperature), [], []));
		expect(t.found).toBe(false);
		if (!t.found) expect(t.reason).toContain('far enough above');
	});

	test('layers with fewer than MIN_SAMPLES temperatures are left out', () => {
		const few = sounding(range(25_000, 43_000), isaTemperature).filter((s) => s.icao === 'A0');
		expect(tropopause(layers(few, [], [])).found).toBe(false);
	});

	test('… and so are layers where one aircraft has all of them, however many', () => {
		const one = sounding(range(25_000, 43_000), isaTemperature).map((s) => ({ ...s, icao: 'A' }));
		expect(tropopause(layers(one, [], [])).found).toBe(false);
	});
});

describe('strongest wind', () => {
	const windAt = (altitude: number, kt: number): WindSample[] =>
		Array.from({ length: MIN_SAMPLES }, (_, i) => ({
			icao: `A${i}`,
			rx: 0,
			altitude,
			wind: toVector(kt, 90), // from the west
			air: toVector(450, 0),
			from: '5,0/6,0' as const,
			at: null
		}));

	test('the fastest layer, and whether it reaches jet stream strength (30 m/s = 58.3 kt)', () => {
		expect(JET_KT).toBeCloseTo(58.32, 2);
		const w = strongestWind(
			layers([], [...windAt(30_000, 40), ...windAt(34_000, 120), ...windAt(38_000, 70)], [])
		);
		expect(w).toMatchObject({ level: 34_000, jet: true, atTop: false, atBottom: false });
		expect(w!.wind.direction).toBeCloseTo(270, 6);
	});

	test('fastest at the edge of the data: the core may be beyond it', () => {
		const w = strongestWind(layers([], [...windAt(36_000, 40), ...windAt(39_000, 50)], []));
		expect(w).toMatchObject({ level: 39_000, jet: false, atTop: true });
	});

	test('nothing with enough samples: null', () => {
		expect(strongestWind(layers([], windAt(36_000, 40).slice(1), []))).toBeNull();
	});

	test('a layer with one aircraft only is left out, however many samples it has', () => {
		const one = Array.from({ length: 50 }, () => ({ ...windAt(35_000, 83)[0], icao: 'A' }));
		const w = strongestWind(layers([], [...one, ...windAt(36_000, 60)], []));
		expect(w).toMatchObject({ level: 36_000, atTop: false, atBottom: false });
		expect(enough(layers([], one, [])[0].wind)).toBe(false);
	});
});
