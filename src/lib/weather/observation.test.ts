import { describe, expect, test } from 'bun:test';
import type { HeadingAndSpeed, TrackAndTurn } from '#lib/modes/registers.ts';
import { MAX_ROLL, observe, turnRate, type Inputs } from './observation';

/** 44CE75's pair from the capture (FL390, 13 Nov 2026), with the 6,0 2 ms after the 5,0. */
const TRACK: TrackAndTurn = {
	bds: '5,0',
	roll: -0.17578125,
	track: 80.33203125,
	groundSpeed: 488,
	trackRate: -0.03125,
	tas: 432
};
const HEADING: HeadingAndSpeed = {
	bds: '6,0',
	heading: 76.640625,
	ias: 230,
	mach: 0.748,
	baroRate: 64,
	inertialRate: -32
};
const RX = Date.UTC(2026, 10, 13, 15, 20);

function inputs(
	track: Partial<TrackAndTurn> = {},
	heading: Partial<HeadingAndSpeed> = {},
	skewMs = 2,
	more: Partial<Inputs> = {}
): Inputs {
	return {
		trackAndTurn: { value: { ...TRACK, ...track }, rx: RX, t: 1000 },
		headingAndSpeed: { value: { ...HEADING, ...heading }, rx: RX, t: 1000 + skewMs },
		altitude: { feet: 39_000, from: { kind: 'reply', df: 20 } },
		position: { lat: 51.853, lon: 12.856, from: 'ADS-B' },
		...more
	};
}

describe('a real pair', () => {
	const o = observe('44CE75', inputs());

	test('wind: magnetic heading + WMM declination, then the triangle', () => {
		expect(o.windProblem).toBeNull();
		expect(o.wind!.declination).toBeCloseTo(4.95, 2); // WMM2025 at 51.85° N 12.86° E
		expect(o.wind!.trueHeading).toBeCloseTo(81.6, 1);
		// By hand: ground (82.0 N, 481.1 E) − air (63.1 N, 427.4 E) = (18.8 N, 53.7 E),
		// 56.9 kt towards 070.7°, so from 250.7°.
		expect(o.wind!.wind.speed).toBeCloseTo(56.9, 1);
		expect(o.wind!.wind.direction).toBeCloseTo(250.7, 1);
	});

	test('temperature: TAS / Mach is the speed of sound', () => {
		expect(o.temperatureProblem).toBeNull();
		expect(o.temperature!.speedOfSound).toBeCloseTo(577.5, 1); // 432 / 0.748
		expect(o.temperature!.kelvin - 273.15).toBeCloseTo(-53.5, 1);
	});

	test('the rounding ranges contain the value', () => {
		const [lo, hi] = o.wind!.speedRange;
		expect(lo).toBeLessThan(o.wind!.wind.speed);
		expect(hi).toBeGreaterThan(o.wind!.wind.speed);
		// Half a step on each of the four inputs: about ±2 kt and ±2° here.
		expect(hi - lo).toBeCloseTo(4.4, 1);
		expect(o.wind!.directionSpread).toBeCloseTo(1.8, 1);
		const [cold, warm] = o.temperature!.range;
		expect(cold).toBeLessThan(o.temperature!.kelvin);
		expect(warm).toBeGreaterThan(o.temperature!.kelvin);
		expect(warm - cold).toBeCloseTo(4.4, 1); // ±2.2 K: TAS ±1 kt, Mach ±0.002
	});
});

describe('what follows from it', () => {
	const o = observe('44CE75', inputs());

	test('the wind as the aircraft feels it: tailwind, crosswind, drift', () => {
		const c = o.wind!.components;
		expect(c.tailwind).toBeCloseTo(55.9, 1);
		expect(c.crosswind).toBeCloseTo(-10.8, 1); // from the right, pushing it left
		expect(c.drift).toBeCloseTo(-1.26, 2); // track 80.33° − true heading 81.60°
	});

	test('3 °C warmer than the standard atmosphere at FL390', () => {
		const a = o.temperature!.atAltitude!;
		expect(a.isa).toBe(216.65); // above the tropopause: −56.5 °C
		expect(a.isaDeviation).toBeCloseTo(3.0, 1);
	});

	test('the probe reads 25 °C warmer than the air', () => {
		// TAT = 219.66 K × (1 + 0.2 × 0.748²) = 244.24 K = −28.9 °C
		expect(o.temperature!.total - 273.15).toBeCloseTo(-28.9, 1);
	});

	test('density: a quarter of sea level, like 300 ft higher in standard air', () => {
		const a = o.temperature!.atAltitude!;
		expect(a.pressure).toBeCloseTo(19_677, 0); // 196.8 hPa: what FL390 means
		expect(a.density).toBeCloseTo(0.3121, 4); // ρ = p / (R·T)
		// Warmer than standard: thinner air, so a higher density altitude.
		expect(a.densityAltitude).toBeCloseTo(39_287, -1);
	});

	test('no altitude: no comparison with the standard atmosphere', () => {
		const t = observe('x', inputs({}, {}, 2, { altitude: null })).temperature!;
		expect(t.atAltitude).toBeNull();
		expect(t.kelvin).toBeCloseTo(o.temperature!.kelvin, 9);
	});
});

describe('when not to trust it', () => {
	test('replies too far apart: neither wind nor temperature', () => {
		const o = observe('44CE75', inputs({}, {}, 2500));
		expect(o.windProblem).toBe('5,0 and 6,0 are 2.5 s apart (at most 2 s)');
		expect(o.temperatureProblem).toBe(o.windProblem);
		expect(o.wind).not.toBeNull(); // computed anyway, to show
	});

	test('banked: no wind, but the temperature is fine', () => {
		const o = observe('44CE75', inputs({ roll: -12.3 }));
		expect(o.windProblem).toBe('turning: banked 12.3° (at most 3°)');
		expect(o.temperatureProblem).toBeNull();
	});

	test('no roll angle: the track rate decides', () => {
		const limit = turnRate(MAX_ROLL, 432);
		expect(limit).toBeCloseTo(0.13, 2);
		expect(observe('x', inputs({ roll: null, trackRate: 0.1 })).windProblem).toBeNull();
		expect(observe('x', inputs({ roll: null, trackRate: -0.5 })).windProblem).toBe(
			'turning: 0.50°/s (at most 0.13°/s, 3° of bank)'
		);
		expect(observe('x', inputs({ roll: null, trackRate: null })).windProblem).toContain(
			"can't tell if it's turning"
		);
	});

	test('a standard rate turn (3°/s) at 250 kt takes about 25° of bank', () => {
		// The pilot's rule of thumb: bank ≈ TAS / 10 + 7 (Federal Aviation Administration,
		// Instrument Flying Handbook): 32°. The exact figure is atan(ω · v / g).
		const bank =
			(Math.atan((((3 * Math.PI) / 180) * 250 * (1852 / 3600)) / 9.80665) * 180) / Math.PI;
		expect(turnRate(bank, 250)).toBeCloseTo(3, 9);
		expect(bank).toBeCloseTo(34.5, 1);
	});

	test('missing values', () => {
		const o = observe('x', inputs({ tas: null }, { heading: null }));
		expect(o.wind).toBeNull();
		expect(o.windProblem).toBe('no 5,0 true airspeed, 6,0 heading');
		expect(o.temperature).toBeNull();
		expect(o.temperatureProblem).toBe('no 5,0 true airspeed');
		expect(observe('x', inputs({}, { mach: 0 })).temperatureProblem).toBe(
			'Mach 0.000 is too small'
		);
	});
});
