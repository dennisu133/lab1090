import { describe, expect, test } from 'bun:test';
import { FT } from '#lib/units.ts';
import { balancingWind, geostrophicWind, segments } from './geostrophic';
import type { ColumnSample } from './profile';

const R = 6_356_766; // the ISA's Earth radius, m (column.ts)
const ORIGIN = { lat: 52, lon: 14 };
const F52 = 2 * 7.292_115e-5 * Math.sin(52 * (Math.PI / 180));

/** The geometric height (ft) whose geopotential height is `feet`: column.ts's inverse. */
const geometric = (feet: number) => (R * feet * FT) / (R - feet * FT) / FT;

/**
 * An aircraft flying level at `altitude` from `from` on a straight track, one sample per
 * 10 km, on pressure surfaces that rise `slope` ft per 100 km (north, east), with its own
 * altimeter error `error` (ft). Heights above sea level, so no geoid is involved.
 */
function flight(
	icao: string,
	altitude: number,
	from: { north: number; east: number },
	track: number,
	km: number,
	slope: { north: number; east: number },
	error = 0
): ColumnSample[] {
	const t = track * (Math.PI / 180);
	return Array.from({ length: km / 10 + 1 }, (_, i) => {
		const north = from.north + i * 10 * Math.cos(t);
		const east = from.east + i * 10 * Math.sin(t);
		const offset = -300 + (slope.north * north + slope.east * east) / 100 + error;
		const gnssMinusBaro = geometric(altitude + offset) - altitude;
		return {
			icao,
			rx: i * 10_000,
			altitude,
			gnssMinusBaro,
			geoid: 0,
			position: {
				lat: ORIGIN.lat + north / 111.32,
				lon: ORIGIN.lon + east / (111.32 * Math.cos(ORIGIN.lat * (Math.PI / 180))),
				from: 'ADS-B' as const
			}
		};
	});
}

/** The capture's slope (sounding.test.ts): down 142 ft per 100 km towards the north. */
const SLOPE = { north: -142, east: 6 };

describe('the balance', () => {
	test('100 ft per 100 km at 52°N: 51 kt, along the contours with the low side on the left', () => {
		// f = 2Ω sin 52° = 1.149e-4 /s; g / f = 85,350 m/s; × 30.48 m / 100 km = 26.0 m/s.
		const rising = balancingWind({ north: 1, east: 0 }, F52); // ft per km
		expect(rising.north).toBeCloseTo(0, 9);
		expect(rising.east).toBeCloseTo(-50.6, 1); // towards the west: high to the north
		const east = balancingWind({ north: 0, east: 1 }, F52);
		expect(east.north).toBeCloseTo(50.6, 1); // towards the north: high to the east
	});
});

describe('the geostrophic wind from level flights', () => {
	const flights = [
		flight('A', 35_000, { north: 50, east: -100 }, 90, 150, SLOPE, 40),
		flight('B', 37_000, { north: 100, east: 30 }, 180, 160, SLOPE, -60),
		flight('C', 38_000, { north: -80, east: 80 }, 315, 140, SLOPE, 10),
		flight('D', 39_000, { north: -60, east: -90 }, 30, 120, SLOPE, -25)
	];

	test('recovers the slope whatever each altimeter is off by', () => {
		const g = geostrophicWind(flights.flat(), ORIGIN, 'sea level');
		if (!g.found) throw new Error(g.reason);
		expect(g.slope.north).toBeCloseTo(-142, 0);
		expect(g.slope.east).toBeCloseTo(6, 0);
		// −(g / f) × −142 ft / 100 km: 72 kt from the west.
		expect(g.wind.speed).toBeCloseTo(71.9, 0);
		expect(g.wind.direction).toBeCloseTo(267.6, 0);
		expect(g.residual).toBeLessThan(0.5);
		expect(g.uncertainty).toBeLessThan(0.5);
		expect(g.aircraft).toBe(4);
		expect(g.levels).toEqual([35_000, 39_000]);
	});

	test('with GNSS − baro in 25 ft steps, as ADS-B sends it, within a few kt', () => {
		const rounded = flights.map((f) =>
			f.map((s) => ({ ...s, gnssMinusBaro: Math.round(s.gnssMinusBaro / 25) * 25 }))
		);
		const g = geostrophicWind(rounded.flat(), ORIGIN, 'sea level');
		if (!g.found) throw new Error(g.reason);
		expect(Math.abs(g.wind.speed - 71.9)).toBeLessThan(5);
		expect(Math.abs(g.wind.direction - 267.6)).toBeLessThan(5);
		expect(g.residual).toBeGreaterThan(5); // ±12.5 ft of rounding: 7 ft rms
		expect(g.residual).toBeLessThan(10);
	});

	test('everyone on one airway: only the slope along it is known', () => {
		const airway = ['A', 'B', 'C'].map((icao, i) =>
			flight(icao, 36_000 + i * 1000, { north: -20 + i * 5, east: -100 }, 90, 150, SLOPE)
		);
		const g = geostrophicWind(airway.flat(), ORIGIN, 'sea level');
		expect(g.found).toBe(false);
		if (!g.found) expect(g.reason).toContain('same way');
	});

	test('fewer than three aircraft, short or unpositioned segments: not found', () => {
		expect(geostrophicWind(flights.slice(0, 2).flat(), ORIGIN, 'sea level').found).toBe(false);
		const short = flights.map((f) => f.slice(0, 2)); // 10 km each
		expect(segments(short.flat(), ORIGIN, 'sea level')).toEqual([]);
		const receiver = flights.flat().map((s) => ({
			...s,
			position: { ...s.position, from: 'receiver' as const }
		}));
		expect(segments(receiver, ORIGIN, 'sea level')).toEqual([]);
	});

	test('a climbing aircraft splits into one segment per level, each too short', () => {
		const climb = flight('E', 30_000, { north: 0, east: 0 }, 0, 100, SLOPE).map((s, i) => ({
			...s,
			altitude: 30_000 + i * 1000
		}));
		expect(segments(climb, ORIGIN, 'sea level')).toEqual([]);
	});
});
