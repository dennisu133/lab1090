import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { fromHex, payload } from './frame';
import { callsign, emitterCategory } from './identification';
import { squitter } from './squitter';

const root = join(import.meta.dir, '../../..');

/** A DF17 identification as the tracker reads it: squitter() on the ME field. */
function identification(data: Uint8Array) {
	const s = squitter(payload(data)!);
	return s.kind === 'identification' ? { callsign: s.callsign, category: s.category } : null;
}

/** pyModeS's full decode of every distinct message in the capture (see tools/README.md). */
const oracle: { message: string; typecode?: number; callsign?: string; category?: number }[] = (
	await Bun.file(join(root, 'oracle/pymodes/decoded.jsonl')).text()
)
	.trim()
	.split('\n')
	.map((line) => JSON.parse(line));

/** Pack 8 characters into 6 bytes, the way an aircraft would (test helper, the inverse). */
function encode(text: string): Uint8Array {
	const codes = [...text.padEnd(8)].map((c) => c.charCodeAt(0) & 0b111111);
	const bytes = new Uint8Array(6);
	for (let half = 0; half < 2; half++) {
		const n = codes.slice(half * 4, half * 4 + 4).reduce((acc, c) => (acc << 6) | c, 0);
		bytes.set([n >> 16, (n >> 8) & 0xff, n & 0xff], half * 3);
	}
	return bytes;
}

describe('callsign characters', () => {
	test('letters, digits and space-padding', () => {
		expect(callsign(encode('DLH4LW'))).toBe('DLH4LW');
		expect(callsign(encode('A1 Z9'))).toBe('A1 Z9'); // inner spaces stay
		expect(callsign(encode('12345678'))).toBe('12345678');
	});

	test('6-bit codes that are no letter, digit or space become #', () => {
		const bytes = encode('ABCD');
		bytes[0] &= 0b000000_11; // first character -> code 0
		expect(callsign(bytes)).toBe('#BCD');
	});
});

test('emitter categories', () => {
	expect(emitterCategory(4, 5)).toEqual({ set: 'A', code: 5, name: 'Heavy (> 136 t)' });
	expect(emitterCategory(4, 3).name).toBe('Large (34–136 t)'); // DLH4LW in the capture
	expect(emitterCategory(4, 0).name).toBe('No category information');
	expect(emitterCategory(3, 1).name).toBe('Glider / sailplane');
	expect(emitterCategory(2, 1).set).toBe('C');
	// Set C: no gap before the service vehicle (MIT LL ATC-334 Table 6-5, readsb).
	expect(emitterCategory(2, 2).name).toBe('Surface vehicle: service');
	expect(emitterCategory(2, 5).name).toBe('Line obstacle');
	expect(emitterCategory(2, 6).name).toBe('Reserved');
	expect(emitterCategory(1, 3).name).toBe('Reserved');
});

test('only type codes 1–4 are identification messages', () => {
	expect(identification(fromHex('8d48e95b9915828df0089c433e2e'))).toBeNull(); // TC 19
});

test('agrees with pyModeS on every identification message in the capture', () => {
	const idents = oracle.filter(
		(o) => o.typecode !== undefined && o.typecode <= 4 && o.typecode >= 1
	);
	expect(idents.length).toBe(12);
	for (const o of idents) {
		const id = identification(fromHex(o.message))!;
		expect(id.callsign).toBe(o.callsign!);
		expect(id.category.code).toBe(o.category!);
	}
});
