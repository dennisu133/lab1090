import { expect, test } from 'bun:test';
import { fromSearchParams, isEmpty, matches, toSearchParams, type FrameQuery } from './frame-query';

const none: FrameQuery = { df: null, tc: null, verdict: null };

test('round trip through the URL', () => {
	const queries: FrameQuery[] = [
		none,
		{ df: 17, tc: null, verdict: null },
		{ df: null, tc: { from: 9, to: 18 }, verdict: null },
		{ df: null, tc: { from: 23, to: 23 }, verdict: 'valid' },
		{ df: 20, tc: null, verdict: 'unknown' }
	];
	for (const q of queries) expect(fromSearchParams(toSearchParams(q))).toEqual(q);
	expect(toSearchParams({ ...none, tc: { from: 9, to: 18 } }).toString()).toBe('tc=9-18');
	expect(toSearchParams({ ...none, tc: { from: 11, to: 11 } }).toString()).toBe('tc=11');
});

test('rejects malformed queries', () => {
	for (const bad of ['df=32', 'df=-1', 'df=x', 'tc=18-9', 'tc=9-', 'tc=40', 'verdict=maybe'])
		expect(() => fromSearchParams(new URLSearchParams(bad))).toThrow(RangeError);
});

test('matching: type codes count for DF17 only', () => {
	const tc = { ...none, tc: { from: 9, to: 18 } };
	expect(matches(tc, { df: 17, tc: 11, verdict: 'valid' })).toBe(true);
	expect(matches(tc, { df: 17, tc: 19, verdict: 'valid' })).toBe(false);
	expect(matches(tc, { df: 18, tc: 11, verdict: 'valid' })).toBe(false);
	expect(matches(tc, { df: 4, tc: null, verdict: 'known' })).toBe(false);
	const both = { df: 20, tc: null, verdict: 'known' as const };
	expect(matches(both, { df: 20, tc: null, verdict: 'known' })).toBe(true);
	expect(matches(both, { df: 20, tc: null, verdict: 'unknown' })).toBe(false);
	expect(matches(none, { df: 0, tc: null, verdict: null })).toBe(true);
	expect(isEmpty(none)).toBe(true);
	expect(isEmpty(both)).toBe(false);
});
