import { expect, test } from 'bun:test';
import { FrameCounts } from './frame-counts';

test('counts by DF, type code (DF17 only), signal bucket and verdict', () => {
	const c = new FrameCounts();
	c.add({ df: 17, tc: 11, verdict: 'valid' }, -20.5);
	c.add({ df: 17, tc: 19, verdict: 'valid' }, -4);
	// A DF18 has a type code too, but the TC counts are for DF17 (see the /frames table).
	c.add({ df: 18, tc: 11, verdict: 'valid' }, -30);
	c.add({ df: 4, tc: null, verdict: 'known' }, -20);
	c.add({ df: 24, tc: null, verdict: null }, -40);
	expect(c.counts).toEqual({
		total: 5,
		byDf: { 4: 1, 17: 2, 18: 1, 24: 1 },
		byTc: { 11: 1, 19: 1 },
		// 3 dB buckets keyed by their lower edge (signalBucket)
		bySignal: { [-21]: 2, [-6]: 1, [-30]: 1, [-42]: 1 },
		byVerdict: { valid: 3, known: 1 }
	});
});
