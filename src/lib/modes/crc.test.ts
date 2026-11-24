import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkParity, crc24, interrogator, syndrome } from './crc';
import { fromHex } from './frame';
import { prng } from './testing';

/**
 * Reference: the textbook bitwise CRC, written independently of crc.ts (25-bit generator,
 * whole-message remainder). If crc.ts's table or byte loop were wrong, these would disagree.
 */
function remainderBitwise(data: Uint8Array): number {
	let r = 0;
	for (const byte of data) {
		for (let bit = 7; bit >= 0; bit--) {
			r = (r << 1) | ((byte >> bit) & 1);
			if (r & 0x1000000) r ^= 0x1fff409;
		}
	}
	return r;
}

/** pyModeS's verdict on every distinct message in the capture (see tools/README.md). */
const oracle = (await Bun.file(join(import.meta.dir, '../../../oracle/pymodes/crc.tsv')).text())
	.split('\n')
	.filter((line) => line && !line.startsWith('#') && !line.startsWith('message'))
	.map((line) => {
		const [message, crc, icao] = line.split('\t');
		return { message, crc: parseInt(crc, 16), icao };
	});

const velocity = fromHex('8d48e95b9915828df0089c433e2e'); // DF17, ICAO 48E95B, parity 433E2E

describe('crc24', () => {
	test('reproduces the parity of a real DF17 message', () => {
		expect(crc24(velocity, 11)).toBe(0x433e2e);
		expect(syndrome(velocity)).toBe(0);
	});

	test('matches the bitwise reference on random messages', () => {
		const random = prng(1090);
		for (let i = 0; i < 2000; i++) {
			const msg = Uint8Array.from({ length: i % 2 ? 14 : 7 }, () => (random() * 256) | 0);
			expect(syndrome(msg)).toBe(remainderBitwise(msg));
		}
	});

	test(`agrees with pyModeS on all ${oracle.length} distinct messages of the capture`, () => {
		expect(oracle.length).toBeGreaterThan(7000);
		for (const { message, crc, icao } of oracle) {
			const data = fromHex(message);
			expect(syndrome(data)).toBe(crc);
			expect(checkParity(data)?.icao).toBe(icao);
		}
	});
});

describe('error detection', () => {
	test('every single-bit error is caught, and each leaves a different syndrome', () => {
		// The second part is why a receiver can *correct* one flipped bit: the syndrome tells
		// which bit it was. (readsb does this on the Pi before it sends anything.)
		const syndromes = new Set<number>();
		for (let bit = 0; bit < 112; bit++) {
			const broken = velocity.slice();
			broken[bit >> 3] ^= 0x80 >> (bit & 7);
			const s = syndrome(broken);
			expect(s).not.toBe(0);
			syndromes.add(s);
		}
		expect(syndromes.size).toBe(112);
	});

	test('a flipped bit in an AP message just yields another address', () => {
		const altitudeReply = fromHex('200017180d1091'); // DF4 from 471EFA
		expect(checkParity(altitudeReply)).toEqual({ kind: 'parity', icao: '471EFA' });

		const broken = altitudeReply.slice();
		broken[3] ^= 0x01;
		const p = checkParity(broken);
		expect(p?.kind).toBe('parity');
		expect(p?.icao).not.toBe('471EFA'); // looks just as plausible: nothing says "corrupted"
	});

	test('a flipped address bit in DF17 makes it invalid', () => {
		const broken = velocity.slice();
		broken[2] ^= 0x10;
		expect(checkParity(broken)).toMatchObject({ kind: 'clear', icao: '48F95B', valid: false });
	});
});

describe('DF11 interrogator codes', () => {
	test('code label and interrogator code', () => {
		expect(interrogator(0)).toEqual({ type: 'II', code: 0 }); // squitter
		expect(interrogator(11)).toEqual({ type: 'II', code: 11 });
		expect(interrogator(17)).toEqual({ type: 'SI', code: 1 }); // CL 1, IC 1
		expect(interrogator(60)).toEqual({ type: 'SI', code: 44 }); // CL 3, IC 12
		expect(interrogator(79)).toEqual({ type: 'SI', code: 63 });
		expect(interrogator(16)).toEqual({ type: 'invalid', code: 16 }); // SI 0 doesn't exist
		expect(interrogator(80)).toEqual({ type: 'invalid', code: 80 }); // CL 5
	});

	test('the code is the syndrome, and only it may be non-zero', () => {
		const squitter = fromHex('5d4ca24e6f7440');
		expect(checkParity(squitter)).toEqual({
			kind: 'clear',
			icao: '4CA24E',
			valid: true,
			interrogator: { type: 'II', code: syndrome(squitter) }
		});

		// another aircraft, replying to a radar: CL 3, IC 12 = SI 44
		const reply = fromHex('5d4400f8dc9adc');
		expect(syndrome(reply)).toBe(60);
		expect(checkParity(reply)).toMatchObject({
			icao: '4400F8',
			valid: true,
			interrogator: { type: 'SI', code: 44 }
		});

		const broken = squitter.slice();
		broken[1] ^= 0x01; // an address bit
		expect(checkParity(broken)).toMatchObject({ valid: false, interrogator: null });
	});
});

test('formats without an address field', () => {
	expect(checkParity(fromHex('99' + '00'.repeat(13)))).toBeNull(); // DF19 AF 1, military format
	expect(checkParity(fromHex('98' + '00'.repeat(13)))).toBeNull(); // DF19 AF 0, CRC doesn't fit
	// DF19 AF 0 whose parity is the plain CRC: laid out like DF17, address in the clear.
	const military = fromHex('98abcdef' + '00'.repeat(10));
	const parity = crc24(military, 11);
	military.set([parity >> 16, (parity >> 8) & 0xff, parity & 0xff], 11);
	expect(checkParity(military)).toMatchObject({ kind: 'clear', icao: 'ABCDEF', valid: true });
});
