import { describe, expect, test } from 'bun:test';
import { adviseGain, noiseDbfs, noiseSigma, ROUNDING_LIMIT_DBFS, roundingCostDb } from './gain';

const R820T = 'Rafael Micro R820T';
const base = { tuner: R820T, gain: 49.6, noise: -40.3, messages: 5000, clipped: 0 };

describe('noise in ADC steps', () => {
	test('from the mean magnitude', () => {
		expect(noiseSigma(-39.8)).toBeCloseTo(1, 5);
		// The Pi at 49.6 dB; its codes' histogram says 0.88 (traffic adds a little).
		expect(noiseSigma(-40.3)).toBeCloseTo(0.94, 2);
		expect(noiseSigma(-50)).toBe(0.2); // below what can be told apart
		expect(noiseSigma(-15.9)).toBeCloseTo(16, 0); // past the table: 6 dB per doubling
	});

	test('and back', () => {
		for (const dbfs of [-44, -40.3, -30, -15])
			expect(noiseDbfs(noiseSigma(dbfs))).toBeCloseTo(dbfs, 5);
		expect(ROUNDING_LIMIT_DBFS).toBeCloseTo(-43.6, 1);
	});

	test('what the rounding costs', () => {
		expect(roundingCostDb(1)).toBeCloseTo(0.35, 2);
		expect(roundingCostDb(0.57)).toBeCloseTo(1, 1);
	});
});

describe('adviseGain', () => {
	test('the Pi at 49.6 dB: noise of 0.9 steps, nothing clipped', () => {
		const advice = adviseGain(base);
		expect(advice.verdict).toBe('fine');
		expect(advice.roundingDb!).toBeCloseTo(0.4, 1);
	});

	test('too high: a step about 3 dB lower', () => {
		expect(adviseGain({ ...base, clipped: 100 })).toMatchObject({ verdict: 'high', suggest: 44.5 });
		expect(adviseGain({ ...base, gain: 1.4, clipped: 100 })).toMatchObject({ suggest: null });
		expect(adviseGain({ ...base, tuner: null, clipped: 100 })).toMatchObject({ suggest: null });
	});

	test('too low: a step about 3 dB higher, or the top one', () => {
		// Far too low: −44.5 dBFS, σ 0.46, rounding costs 1.5 dB. (40.2 dB on the Pi gives
		// −42.1 dBFS: fine by this rule.)
		const low = { ...base, gain: 40.2, noise: -44.5 };
		expect(adviseGain(low)).toMatchObject({ verdict: 'low', suggest: 43.4, atTop: false });
		expect(adviseGain({ ...low, gain: 48 })).toMatchObject({ suggest: 49.6, atTop: false });
		expect(adviseGain({ ...low, gain: 49.6 })).toMatchObject({ suggest: null, atTop: true });
	});

	test('both ends at once: leave it', () => {
		expect(adviseGain({ ...base, noise: -44.5, clipped: 30 }).verdict).toBe('fine');
	});

	test('clipping needs traffic to judge', () => {
		expect(adviseGain({ ...base, messages: 50 }).verdict).toBe('unknown');
		expect(adviseGain({ ...base, messages: 50, noise: -44 }).verdict).toBe('low');
	});
});
