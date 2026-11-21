import { describe, expect, test } from 'bun:test';
import { dbfs, fixed, n, perSecond, signed, upTo } from './format.ts';

// The module promises English separators and a real minus (U+2212), never the locale's
// hyphen, and no minus on a value that rounds to zero ("−0.0" reads as below zero).
describe('number formats', () => {
	test('a real minus, thousands separators', () => {
		expect(n(-1500)).toBe('−1,500');
		expect(fixed(-27.34)).toBe('−27.3');
		expect(upTo(-0.8041, 3)).toBe('−0.804');
		expect(dbfs(-3)).toBe('−3.0 dBFS');
	});

	test('no minus on what rounds to zero', () => {
		expect(n(-0.3)).toBe('0');
		expect(fixed(-0.04)).toBe('0.0');
		expect(upTo(-0.0004, 3)).toBe('0');
		expect(signed(-0.04)).toBe('0.0');
	});

	test('upTo drops trailing zeros, fixed keeps them', () => {
		expect(upTo(12_450, 0)).toBe('12,450');
		expect(upTo(1.5, 2)).toBe('1.5');
		expect(fixed(0.25, 3)).toBe('0.250');
	});

	test('a rate keeps one decimal only below 100, and never shows "100.0"', () => {
		expect(perSecond(57.34)).toBe('57.3');
		expect(perSecond(99.97)).toBe('100');
		expect(perSecond(2345.6)).toBe('2,346');
	});
});
