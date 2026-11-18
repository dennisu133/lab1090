import { describe, expect, test } from 'bun:test';
import { magnitudes, magnitudesSum } from './samples';

describe('magnitudes', () => {
	test('are the same read as 16-bit pairs or byte by byte, and so is their sum', () => {
		// Every (I, Q) pair once, starting at an even byte and (one byte in) at an odd one: the
		// odd start can't be read as 16-bit numbers.
		const bytes = new Uint8Array(1 + 2 * 65536);
		for (let x = 0; x < 65536; x++) {
			bytes[1 + 2 * x] = x >> 8;
			bytes[2 + 2 * x] = x & 0xff;
		}
		const even = bytes.slice(1);
		const odd = bytes.subarray(1);
		expect(odd.byteOffset % 2).toBe(1);
		const byByte = new Uint16Array(65536);
		magnitudes(even, 0, 65536, byByte, 0);
		const fromEven = new Uint16Array(65536);
		const fromOdd = new Uint16Array(65536);
		const sum = byByte.reduce((a, m) => a + m, 0);
		expect(magnitudesSum(even, 0, 65536, fromEven, 0)).toBe(sum);
		expect(magnitudesSum(odd, 0, 65536, fromOdd, 0)).toBe(sum);
		expect(fromEven).toEqual(byByte);
		expect(fromOdd).toEqual(byByte);
		// I = Q = 127 or 128 is half a step from zero on both; 0, 0 is (almost) full scale.
		expect(byByte[(127 << 8) | 128]).toBe(byByte[(128 << 8) | 127]);
		expect(byByte[0]).toBe(65535);
	});
});
