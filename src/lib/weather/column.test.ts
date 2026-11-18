import { describe, expect, test } from 'bun:test';
import { FT } from '#lib/units.ts';
import {
	G0,
	R_AIR,
	isaTemperature,
	pressureAltitude,
	staticPressure
} from '#lib/modes/air-data.ts';
import { column, expectedOffset, feetPerKelvin, geopotential } from './column';

const EARTH_RADIUS = 6_356_766;

/**
 * An independent check: build a made-up atmosphere by integrating the hydrostatic
 * equation (dH = (R / g₀) · T · d(ln p)) upwards from sea level in small pressure steps,
 * find the height of an aircraft's pressure level, and turn it into what the aircraft
 * would send. column() must then find the column's temperature again.
 *
 * `deviation(p)`: how much warmer than ISA the air at pressure p (Pa) is, K.
 */
function aircraftIn(
	qnh: number,
	deviation: (pascal: number) => number,
	altitude: number,
	geoid: number
): { gnssMinusBaro: number; meanDeviation: number } {
	const target = staticPressure(altitude);
	const steps = 20_000;
	const dLnP = Math.log((qnh * 100) / target) / steps;
	let h = 0; // geopotential, m
	let weighted = 0;
	for (let i = 0; i < steps; i++) {
		const p = qnh * 100 * Math.exp(-(i + 0.5) * dLnP); // midpoint of the step
		const t = isaTemperature(pressureAltitude(p)) + deviation(p);
		h += (R_AIR / G0) * t * dLnP;
		weighted += deviation(p) * dLnP;
	}
	const geometric = (EARTH_RADIUS * h) / (EARTH_RADIUS - h); // m above sea level
	const ellipsoid = geometric + geoid;
	return {
		gnssMinusBaro: ellipsoid / FT - altitude,
		meanDeviation: weighted / (steps * dLnP)
	};
}

describe('column', () => {
	test('a standard day: no offset beyond the geoid and geopotential corrections', () => {
		const a = aircraftIn(1013.25, () => 0, 35_000, 40);
		const c = column(
			{ altitude: 35_000, gnssMinusBaro: a.gnssMinusBaro, geoid: 40 },
			{ qnh: 1013.25, heights: 'ellipsoid' }
		);
		// The aircraft sends +190 ft: 131 ft of geoid and 59 ft of geopotential vs geometric.
		expect(a.gnssMinusBaro).toBeCloseTo(190.5, 0);
		expect(c.offset).toBeCloseTo(0, 1);
		expect(c.isaDeviation).toBeCloseTo(0, 3);
	});

	test('a cold column on a low-pressure day', () => {
		for (const altitude of [5_000, 20_000, 35_000, 41_000]) {
			const a = aircraftIn(1003, () => -8, altitude, 40);
			const c = column(
				{ altitude, gnssMinusBaro: a.gnssMinusBaro, geoid: 40 },
				{ qnh: 1003, heights: 'ellipsoid' }
			);
			expect(c.isaDeviation).toBeCloseTo(-8, 2);
			// 10.25 hPa below standard lowers every level by about 281 ft.
			expect(c.pressurePart).toBeCloseTo(-281.1, 1);
		}
	});

	test('heights above sea level: no geoid correction', () => {
		const a = aircraftIn(1020, () => 5, 30_000, 0);
		const c = column(
			{ altitude: 30_000, gnssMinusBaro: a.gnssMinusBaro, geoid: 40 },
			{ qnh: 1020, heights: 'sea level' }
		);
		expect(c.seaLevelHeight).toBe(c.gnssHeight);
		expect(c.isaDeviation).toBeCloseTo(5, 2);
	});

	test('a column with warm air below and standard air above gives the ln p-weighted mean', () => {
		// 10 K warmer below 700 hPa (about 10,000 ft), standard above.
		const a = aircraftIn(1013.25, (p) => (p > 70_000 ? 10 : 0), 35_000, 0);
		const c = column(
			{ altitude: 35_000, gnssMinusBaro: a.gnssMinusBaro, geoid: 0 },
			{ qnh: 1013.25, heights: 'sea level' }
		);
		// ln(1013.25 / 700) / ln(1013.25 / 238.4) = 0.256 of the column is warm: +2.6 K.
		expect(a.meanDeviation).toBeCloseTo(2.56, 2);
		expect(c.isaDeviation).toBeCloseTo(a.meanDeviation, 2);
	});

	test("the capture's −775 ft at FL350: a column about 7 K colder than standard", () => {
		// Median GNSS − baro at FL350 in fixtures/capture.beast; geoid 40.85 m at 52°N 14°E.
		// If QNH was standard, that's −775 − 134 (geoid) − 59 (geopotential) = −965 ft,
		// at 139 ft per kelvin.
		const c = column(
			{ altitude: 35_000, gnssMinusBaro: -775, geoid: 40.85 },
			{ qnh: 1013.25, heights: 'ellipsoid' }
		);
		expect(c.offset).toBeCloseTo(-964.6, 0);
		expect(c.isaDeviation).toBeCloseTo(-6.94, 1);
	});
});

describe('the pieces', () => {
	test('geopotential: 59 ft less than geometric at 35,000 ft', () => {
		// H = r · z / (r + z) with r = 6,356,766 m.
		expect(35_000 - geopotential(35_000)).toBeCloseTo(58.6, 1);
		expect(geopotential(0)).toBe(0);
	});

	test('139 ft per kelvin at FL350: (R / g) · ln(1013.25 / 238.4)', () => {
		expect(staticPressure(35_000)).toBeCloseTo(23_842, 0);
		expect(feetPerKelvin(35_000, 1013.25)).toBeCloseTo(138.95, 1);
	});

	test('expectedOffset: what column() would see for a known column', () => {
		const a = aircraftIn(995, () => -4, 25_000, 0);
		expect(expectedOffset(25_000, -4, 995)).toBeCloseTo(
			column(
				{ altitude: 25_000, gnssMinusBaro: a.gnssMinusBaro, geoid: 0 },
				{ qnh: 995, heights: 'sea level' }
			).offset,
			1
		);
	});
});
