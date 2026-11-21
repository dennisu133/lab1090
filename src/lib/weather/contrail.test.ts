import { describe, expect, test } from 'bun:test';
import { staticPressure } from '#lib/modes/air-data.ts';
import {
	contrail,
	contrailRange,
	ETA_OLDER,
	mixingLineSlope,
	olderEngineShift,
	saturationOverIce,
	saturationOverWater,
	schumannFit,
	thresholds
} from './contrail';

const C = 273.15;

describe('saturation vapour pressure (Sonntag 1994)', () => {
	test('matches the tabulated values at 0 °C and −40 °C', () => {
		// Murphy & Koop (2005), Q. J. R. Meteorol. Soc. 131, table C1: water 611.2 Pa at
		// 0 °C and 18.99 Pa (supercooled) at −40 °C; ice 12.84 Pa at −40 °C.
		expect(saturationOverWater(C)).toBeCloseTo(611.2, 0);
		expect(Math.abs(saturationOverWater(C - 40) - 18.99)).toBeLessThan(0.1);
		expect(Math.abs(saturationOverIce(C - 40) - 12.84)).toBeLessThan(0.05);
	});

	test('ice saturates at lower pressure than supercooled water, more so the colder it is', () => {
		// Why a contrail can persist in air that's far from saturated over water: at −50 °C
		// ice saturation is about 60 % relative humidity over water.
		const ratio = (c: number) => saturationOverIce(C + c) / saturationOverWater(C + c);
		expect(ratio(-20)).toBeCloseTo(0.82, 2);
		expect(ratio(-50)).toBeCloseTo(0.61, 2);
	});
});

describe('the Schmidt–Appleman thresholds', () => {
	test('the mixing line at 250 hPa: G = 1.80 Pa/K, T_LM = −40.9 °C', () => {
		// G = 1.25 · 1004 · 25,000 / (0.622 · 43 × 10⁶ · 0.65) by hand.
		expect(mixingLineSlope(25_000)).toBeCloseTo(1.805, 3);
		expect(thresholds(25_000).saturated - C).toBeCloseTo(-40.9, 1);
	});

	test("the exact tangent agrees with Schumann's fit (1996, eq. 31) within 0.05 K", () => {
		for (let hPa = 150; hPa <= 500; hPa += 25) {
			const t = thresholds(hPa * 100);
			expect(Math.abs(t.saturated - schumannFit(t.slope))).toBeLessThan(0.05);
		}
	});

	test('dry air needs about 10 K colder than saturated air at cruise levels', () => {
		for (const fl of [300, 350, 390]) {
			const t = thresholds(staticPressure(fl * 100));
			expect(t.saturated - t.dry).toBeGreaterThan(9);
			expect(t.saturated - t.dry).toBeLessThan(10);
		}
	});

	test('an older engine (η = 0.3) needs air about 0.8 K colder', () => {
		// Less of the fuel's heat goes into thrust, so the plume is warmer and drier for its
		// temperature: a flatter mixing line, which touches the curve lower down.
		for (const hPa of [150, 200, 250, 300, 400]) {
			const shift = olderEngineShift(hPa * 100);
			expect(shift).toBe(
				thresholds(hPa * 100).saturated - thresholds(hPa * 100, ETA_OLDER).saturated
			);
			expect(shift).toBeGreaterThan(0.7);
			expect(shift).toBeLessThan(0.9);
		}
	});

	test('the humidity needed runs from 0 at the dry threshold to 1 at the saturated one', () => {
		const p = staticPressure(37_000);
		const t = thresholds(p);
		expect(contrail(t.dry - 0.1, p).verdict).toBe('always');
		expect(contrail(t.dry + 0.01, p).humidityNeeded).toBeCloseTo(0, 2);
		expect(contrail(t.saturated - 0.01, p).humidityNeeded).toBeCloseTo(1, 2);
		expect(contrail(t.saturated + 0.1, p).verdict).toBe('never');
		let last = 0;
		for (let k = t.dry + 0.5; k < t.saturated; k += 0.5) {
			const c = contrail(k, p);
			expect(c.verdict).toBe('humid');
			expect(c.humidityNeeded!).toBeGreaterThan(last);
			last = c.humidityNeeded!;
		}
	});

	test('a yes or no only if it holds 2 K either way', () => {
		const p = staticPressure(37_000);
		const t = thresholds(p);
		expect(contrailRange(t.dry - 2.5, p).verdict).toBe('always');
		// Measured just cold enough for dry air, but 2 K warmer it would need humidity.
		const near = contrailRange(t.dry - 1, p);
		expect(near.at.verdict).toBe('always');
		expect(near.verdict).toBe('humid');
		expect(near.colder.humidityNeeded).toBe(0);
		expect(near.warmer.humidityNeeded!).toBeGreaterThan(0);
		expect(contrailRange(t.saturated + 1, p).verdict).toBe('humid');
		expect(contrailRange(t.saturated + 2.5, p).verdict).toBe('never');
	});
});
