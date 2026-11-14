import { expect, test } from 'bun:test';
import { bitsTitle } from './comm-b.ts';

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
