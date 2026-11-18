import { expect, test } from 'bun:test';
import type { Comparison } from '#lib/modes/comm-b.ts';
import { bitsTitle, comparisonFields } from './comm-b.ts';

test('bitsTitle numbers the bits like the spec tables, 8 per line', () => {
	// 2,0 starts with its own number, 0x20: bits 1–8 = 0010 0000.
	expect(bitsTitle('20000000000001', 'MB').split('\n')).toEqual([
		'MB field (56 bits) in binary:',
		'  1–8  0010 0000',
		' 9–16  0000 0000',
		'17–24  0000 0000',
		'25–32  0000 0000',
		'33–40  0000 0000',
		'41–48  0000 0000',
		'49–56  0000 0001'
	]);
});

test('comparisons: one rule for the digits, in the value and the tooltip alike', () => {
	const base = { from: { kind: 'adsb', tc: 19 } as const, ageMs: 1500 };
	const comparisons: Comparison[] = [
		{
			...base,
			kind: 'numeric',
			quantity: 'track',
			unit: '°',
			commB: 90.4,
			other: 92.6,
			difference: 2.2,
			tolerance: 10,
			ok: true
		},
		{
			...base,
			kind: 'numeric',
			quantity: 'Mach',
			unit: '',
			commB: 0.8043,
			other: 0.85,
			difference: 0.0457,
			tolerance: 0.03,
			ok: false
		},
		{ ...base, kind: 'position', difference: 87.24, tolerance: 1.5, ok: false },
		{ ...base, kind: 'text', quantity: 'callsign', commB: 'DLH4LW', other: 'DLH4LW', ok: true },
		{ ...base, kind: 'copy', ok: true }
	];
	const fields = comparisonFields(comparisons);
	expect(fields.map((f) => f.value)).toEqual([
		'✓ track Δ2°',
		'✗ Mach 0.804 vs 0.85',
		'✗ position 87.2 km off',
		'✓ callsign',
		'✓ = DF17'
	]);
	expect(fields[0].title).toBe('Comm-B: 90°. TC 19 1.5 s earlier: 93°. Allowed difference: 10°');
});
