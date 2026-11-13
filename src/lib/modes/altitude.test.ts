import { describe, expect, test } from 'bun:test';
import { altitudeCode, replyAltitude, squitterAltitude } from './altitude';
import { bits, fromHex, payload } from './frame';
import { replySquawk, squawk } from './squawk';
import { codes, oracle } from './testing';

const ALL_CODES = Array.from({ length: 1 << 13 }, (_, code) => code);

describe('the 13-bit altitude code', () => {
	test('agrees with pyModeS on all 8,192 possible codes', () => {
		for (const code of ALL_CODES) {
			expect(altitudeCode(code).feet).toBe(codes.altitude[code]);
		}
	});

	test('Q = 1: every 25 ft step from −1,000 to 50,175 ft, each exactly once', () => {
		const feet = ALL_CODES.map(altitudeCode)
			.filter((a) => a.encoding === '25 ft')
			.map((a) => a.feet!);
		expect(feet.length).toBe(2048); // 11 bits
		expect(new Set(feet).size).toBe(2048);
		expect(Math.min(...feet)).toBe(-1000);
		expect(Math.max(...feet)).toBe(50_175);
	});

	test('Gillham: every 100 ft step from −1,200 to 126,700 ft, each exactly once', () => {
		const valid = ALL_CODES.filter((c) => altitudeCode(c).encoding === 'Gillham')
			.map((code) => ({ code, feet: altitudeCode(code).feet }))
			.filter((a) => a.feet !== null)
			.sort((a, b) => a.feet! - b.feet!);
		expect(valid.length).toBe(1280); // 256 × 500 ft, 5 steps of 100 ft each
		expect(new Set(valid.map((a) => a.feet)).size).toBe(1280);
		expect(valid[0].feet).toBe(-1200);
		expect(valid.at(-1)!.feet).toBe(126_700);

		// The point of a Gray code: one step up or down changes exactly one bit (one pulse).
		for (let i = 1; i < valid.length; i++) {
			const changed = valid[i].code ^ valid[i - 1].code;
			expect(changed & (changed - 1)).toBe(0); // a power of two: a single bit
		}
	});

	test('0 means unknown; the M bit means metric', () => {
		expect(altitudeCode(0)).toEqual({ feet: null, encoding: 'none' });
		expect(altitudeCode(0b0000001010000).encoding).toBe('metric');
	});
});

describe('altitudes in the capture', () => {
	test('DF0/4/16/20: agree with pyModeS', () => {
		const replies = oracle.filter((o) => [0, 4, 16, 20].includes(o.df));
		expect(replies.length).toBeGreaterThan(2500);
		for (const o of replies) expect(replyAltitude(o.data).feet).toBe(o.altitude);
	});

	test('ADS-B TC 9–18: agree with pyModeS', () => {
		const positions = oracle.filter((o) => o.df === 17 && o.typecode >= 9 && o.typecode <= 18);
		expect(positions.length).toBe(2763);
		for (const o of positions) {
			expect(squitterAltitude(bits(payload(o.data)!, 9, 12)).feet).toBe(o.altitude);
		}
	});

	test('the same aircraft, the same moment: DF4 reply and ADS-B say the same', () => {
		// 78103B (Air China, CCA749): TC 0 (no position), but the altitude field is filled.
		const adsb = fromHex('8d78103b00c380000000002ba316');
		const reply = fromHex('20001838699360'); // its DF4
		expect(squitterAltitude(bits(payload(adsb)!, 9, 12))).toEqual({
			feet: 38_000,
			encoding: '25 ft'
		});
		expect(replyAltitude(reply).feet).toBe(38_000);
	});
});

describe('squawk', () => {
	test('agrees with pyModeS on all 8,192 possible codes', () => {
		for (const code of ALL_CODES) expect(squawk(code)).toBe(codes.squawk[code]);
	});

	test('bit by bit: 1200 is A1 and B2', () => {
		// C1 A1 C2 A2 C4 A4 X B1 D1 B2 D2 B4 D4
		expect(squawk(0b0100000001000)).toBe('1200');
		expect(squawk(0b0000000100000)).toBe('0100'); // B1 alone
		expect(squawk(0b0000010000000)).toBe('4000'); // A4 alone
		expect(squawk(0b0000000000001)).toBe('0004'); // D4 alone
	});

	test('DF5/21 in the capture: agree with pyModeS', () => {
		const replies = oracle.filter((o) => o.df === 5 || o.df === 21);
		expect(replies.length).toBeGreaterThan(1000);
		for (const o of replies) expect(replySquawk(o.data)).toBe(o.squawk);
	});
});
