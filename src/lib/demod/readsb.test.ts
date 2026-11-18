import { describe, expect, test } from 'bun:test';
import { modulate } from './modulate';
import { readsbPreamble, sliceBit } from './readsb';
import { magnitudes } from './samples';

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
const DF17 = hex('8D4840D6202CC371C32CE0576098');
const bitAt = (data: Uint8Array, i: number) => ((data[i >> 3] >> (7 - (i & 7))) & 1) as 0 | 1;

/** DF17 starting `at` samples in, as magnitudes. */
function samples(at: number, pulse: 'box' | 'dongle'): Uint16Array {
	const iq = modulate([{ data: DF17, at, amplitude: 0.3 }], 400, { noise: 0.002, pulse });
	const mag = new Uint16Array(400);
	magnitudes(iq, 0, 400, mag, 0);
	return mag;
}

describe("readsb's test and slicer", () => {
	test('find the preamble and read every bit, wherever between two samples it starts', () => {
		for (const pulse of ['box', 'dongle'] as const)
			for (let tick = 0; tick < 5; tick++) {
				const mag = samples(50 + tick / 5, pulse);
				expect(readsbPreamble(mag, 50)).toBe(true);
				for (let i = 0; i < 112; i++)
					expect(sliceBit(mag, 250 + tick + 96 + 12 * i)).toBe(bitAt(DF17, i));
			}
	});

	test('let nothing in where there is no message', () => {
		const mag = samples(200, 'dongle');
		for (let n = 1; n < 150; n++) expect(readsbPreamble(mag, n)).toBe(false);
	});
});
