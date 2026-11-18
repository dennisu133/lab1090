import { describe, expect, test } from 'bun:test';
import { modulate } from './modulate';
import { EARLY, LATE, readsbCheck, readsbPhases, sliceBits } from './readsb';
import { magnitudes } from './samples';

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
const DF17 = hex('8D4840D6202CC371C32CE0576098');
const bitAt = (data: Uint8Array, i: number) => ((data[i >> 3] >> (7 - (i & 7))) & 1) as 0 | 1;

/**
 * Whether readsb would try a message starting between sample n and n + 1 (ticks 5n … 5n + 4).
 *
 * readsb looks at sample p for a preamble starting 0.6 to 1.4 samples after it: at tick
 * 5p + 3 … 5p + 7, its "phases" 3 to 7. So p = n covers our starts 5n + 3 and 5n + 4
 * (LATE), and p = n − 1 the others (EARLY). `mag` must hold a sample before n. The
 * parts put together like demodulator.ts step 1, which works out each sample's only once.
 */
function readsbPreamble(mag: Uint16Array, n: number): boolean {
	return (
		(readsbCheck(mag, n) === 1 && (readsbPhases(mag, n) & LATE) !== 0) ||
		(n > 0 && readsbCheck(mag, n - 1) === 1 && (readsbPhases(mag, n - 1) & EARLY) !== 0)
	);
}

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
				// All at once, and the format first, then the rest (as the demodulator does).
				const all = new Uint8Array(112);
				sliceBits(mag, 250 + tick + 96, all, 0, 112);
				const parts = new Uint8Array(112);
				sliceBits(mag, 250 + tick + 96, parts, 0, 5);
				sliceBits(mag, 250 + tick + 96, parts, 5, 112);
				for (let i = 0; i < 112; i++) {
					expect(all[i]).toBe(bitAt(DF17, i));
					expect(parts[i]).toBe(bitAt(DF17, i));
				}
			}
	});

	test('let nothing in where there is no message', () => {
		const mag = samples(200, 'dongle');
		for (let n = 1; n < 150; n++) expect(readsbPreamble(mag, n)).toBe(false);
	});
});
