import { expect, test } from 'bun:test';
import { estimatePeriod, gaps } from './period';
import { random } from './testing';

/** Burst times of one aircraft: every turn of `period` s from `phase`, some turns missed. */
function times(period: number, phase: number, turns: number, seed: number): number[] {
	const rand = random(seed);
	return Array.from({ length: turns }, (_, n) => phase + n * period).filter(() => rand() < 0.7);
}

test('the period, not a fraction of it', () => {
	const est = estimatePeriod(gaps([times(5, 0, 100, 1), times(5, 1.3, 100, 2)]))!;
	expect(est.period).toBeCloseTo(5, 3);
	expect(est.score).toBeCloseTo(1, 3);
});

test('a slow radar: 10 s', () => {
	expect(estimatePeriod(gaps([times(10.0336, 0.2, 60, 3)]))!.period).toBeCloseTo(10.0336, 3);
});

test('two radars on one code, same period, different phase: still the period', () => {
	// One aircraft hears both, 1.7 s apart: the gaps between the two radars' bursts must
	// not pull the estimate (the cosine comb alone puts it at 4.99 s).
	const both = [...times(5, 0, 120, 4), ...times(5, 1.7, 120, 5)].sort((a, b) => a - b);
	expect(estimatePeriod(gaps([both]))!.period).toBeCloseTo(5, 3);
});

test('too few gaps: no estimate', () => {
	expect(estimatePeriod(gaps([[0, 5, 10]]))).toBeNull();
});
