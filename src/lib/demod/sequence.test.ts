import { describe, expect, test } from 'bun:test';
import { modulate } from './modulate';
import { magnitudes } from './samples';
import { SequenceReader } from './sequence';

/** Random 112-bit messages with format 17 (the reader decides the length from it). */
function messages(count: number, seed: number): Uint8Array[] {
	let a = seed;
	const random = () => ((a = (a * 1103515245 + 12345) >>> 0) >>> 8) & 0xff;
	return Array.from({ length: count }, () => {
		const data = Uint8Array.from({ length: 14 }, random);
		data[0] = (17 << 3) | (data[0] & 7);
		return data;
	});
}

const bitAt = (data: Uint8Array, i: number) => (data[i >> 3] >> (7 - (i & 7))) & 1;

/**
 * Each message alone, 0.3 samples past a sample (ticks: 5·at). Returns how many messages the
 * sequence reader and the bit-by-bit rule (first half vs second half of each bit) got wrong.
 */
function wrongMessages(pulse: 'box' | 'dongle', amplitude: number, noise: number) {
	const reader = new SequenceReader();
	let sequence = 0;
	let byBit = 0;
	for (const [n, data] of messages(300, 7).entries()) {
		const at = 20.3;
		const iq = modulate([{ data, at, amplitude }], 340, { noise, seed: n + 1, pulse });
		const mag = new Uint16Array(340);
		magnitudes(iq, 0, 340, mag, 0);
		const s = Math.round(at * 5);
		const bits = new Uint8Array(112);
		const length = reader.read(mag, s, bits);
		// Energy over ticks [a, b): a sample stands for 5 ticks.
		const energy = (a: number, b: number) => {
			let e = 0;
			for (let t = a; t < b; t++) e += mag[Math.floor(t / 5)];
			return e;
		};
		let sequenceRight = length === 112;
		let byBitRight = true;
		for (let i = 0; i < 112; i++) {
			const t = s + 96 + 12 * i;
			if (bits[i] !== bitAt(data, i)) sequenceRight = false;
			if ((energy(t, t + 6) > energy(t + 6, t + 12) ? 1 : 0) !== bitAt(data, i)) byBitRight = false;
		}
		if (!sequenceRight) sequence++;
		if (!byBitRight) byBit++;
	}
	return { sequence, byBit };
}

describe('SequenceReader', () => {
	test('reads clean messages without a wrong bit, whatever the pulse shape', () => {
		for (const pulse of ['box', 'dongle'] as const)
			expect(wrongMessages(pulse, 0.3, 0).sequence).toBe(0);
	});

	test('reads more weak messages right than bit by bit when the pulses ring like the dongle’s', () => {
		// About 11 dB above the noise (the Pi's: 0.0095 on I and Q), where messages are weak
		// but readable: bit by bit gets two thirds of them wrong.
		const { sequence, byBit } = wrongMessages('dongle', 0.05, 0.0095);
		expect(byBit).toBeGreaterThan(180);
		expect(sequence).toBeLessThan(byBit * 0.75);
	});
});
