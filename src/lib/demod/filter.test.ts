import { describe, expect, test } from 'bun:test';
import { crc24 } from '#lib/modes/crc.ts';
import { KNOWN_FOR_S, MessageFilter } from './filter';

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
/** An airborne position from 4840D6 (pyModeS's example), CRC 0. */
const DF17 = hex('8D4840D6202CC371C32CE0576098');

function flip(data: Uint8Array, bit: number): Uint8Array {
	const out = data.slice();
	out[(bit - 1) >> 3] ^= 0x80 >> ((bit - 1) & 7);
	return out;
}

/** A short message with its parity: the CRC, XORed with `overlay` (an address or a code). */
function short(df: number, body: number[], overlay: number): Uint8Array {
	const data = new Uint8Array([(df << 3) | 5, ...body, 0, 0, 0]);
	const parity = crc24(data, 4) ^ overlay;
	data.set([parity >> 16, (parity >> 8) & 0xff, parity & 0xff], 4);
	return data;
}

describe('MessageFilter', () => {
	test('takes ADS-B with CRC 0', () => {
		const filter = new MessageFilter();
		expect(filter.check(DF17, 0)).toBe(DF17);
		expect(filter.stats.accepted).toBe(1);
	});

	test('repairs one bit, but only for an aircraft already heard intact', () => {
		const filter = new MessageFilter();
		for (const bit of [6, 9, 40, 88, 89, 112]) expect(filter.check(flip(DF17, bit), 0)).toBeNull();
		filter.check(DF17, 1);
		for (const bit of [6, 9, 40, 88, 89, 112]) {
			expect(filter.check(flip(DF17, bit), 2)).toEqual(DF17);
		}
		expect(filter.stats.repaired).toBe(6);
		// Not two wrong bits.
		expect(filter.check(flip(flip(DF17, 40), 41), 2)).toBeNull();
	});

	test('repairs a wrong bit in the format that turned DF17 into another long format', () => {
		const filter = new MessageFilter();
		// 17 = 10001: bit 2 gives 25, 3 gives 21, 4 gives 19, 5 gives 16.
		for (const bit of [2, 3, 4, 5]) expect(filter.check(flip(DF17, bit), 0)).toBeNull();
		filter.check(DF17, 1);
		for (const bit of [2, 3, 4, 5]) expect(filter.check(flip(DF17, bit), 2)).toEqual(DF17);
		expect(filter.stats.repaired).toBe(4);
		// Bit 1 gives DF1, a short format: not this rule's.
		expect(filter.check(flip(DF17, 1), 2)).toBeNull();
	});

	test('takes DF11 squitters, and replies to a radar from known aircraft only', () => {
		const filter = new MessageFilter();
		const address = [0x48, 0x40, 0xd6];
		const squitter = short(11, address, 0);
		const toRadar = short(11, address, 0x12); // SI 17
		expect(filter.check(toRadar, 0)).toBeNull();
		expect(filter.check(squitter, 0)).toBe(squitter);
		expect(filter.check(toRadar, 1)).toBe(toRadar);
		// Not a radar code, nor one wrong bit: the syndrome has bits above the lowest seven.
		expect(filter.check(short(11, address, 0x81), 1)).toBeNull();
	});

	test('repairs one bit in a DF11 squitter from a known aircraft, but not in a code', () => {
		const filter = new MessageFilter();
		const squitter = short(11, [0x48, 0x40, 0xd6], 0);
		expect(filter.check(flip(squitter, 20), 0)).toBeNull();
		filter.check(squitter, 0);
		for (const bit of [6, 20, 33, 49])
			expect(filter.check(flip(squitter, bit), 1)).toEqual(squitter);
		expect(filter.stats.repaired).toBe(4);
		// A wrong bit among the last 7 reads as a radar's code: taken as it is.
		const toRadar = flip(squitter, 50);
		expect(filter.check(toRadar, 1)).toBe(toRadar);
		expect(filter.stats.repaired).toBe(4);
	});

	test('takes replies with the address in the parity from known aircraft only', () => {
		const filter = new MessageFilter();
		const reply = short(4, [0x00, 0x0d, 0x30], 0x4840d6);
		expect(filter.check(reply, 0)).toBeNull();
		filter.check(DF17, 0);
		expect(filter.check(reply, 1)).toBe(reply);
		expect(filter.check(short(4, [0x00, 0x0d, 0x30], 0x123456), 1)).toBeNull();
	});

	test('forgets an aircraft after a minute', () => {
		const filter = new MessageFilter();
		const reply = short(4, [0x00, 0x0d, 0x30], 0x4840d6);
		filter.check(DF17, 0);
		expect(filter.check(reply, KNOWN_FOR_S)).toBe(reply);
		expect(filter.known).toBe(1);
		expect(filter.check(reply, KNOWN_FOR_S + 1)).toBeNull();
		expect(filter.known).toBe(0);
	});

	test('drops formats that don’t exist', () => {
		const filter = new MessageFilter();
		expect(filter.check(short(7, [0, 0, 0], 0), 0)).toBeNull();
	});
});
