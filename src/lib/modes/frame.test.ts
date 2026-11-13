import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BeastParser } from '#lib/server/beast/parser.ts';
import {
	containmentRadius,
	downlinkFormat,
	fromHex,
	icaoAddress,
	signalBucket,
	signalDbfs,
	toHex,
	TYPE_CODE_GROUPS,
	typeCode,
	typeCodeGroup,
	typeCodeName
} from './frame';

const capture = new Uint8Array(
	await Bun.file(join(import.meta.dir, '../../../fixtures/capture.beast')).arrayBuffer()
);
const frames = new BeastParser().push(capture);

describe('a known DF17 velocity message', () => {
	// from the first live test: DF17, CA 5, ICAO 48E95B, TC 19
	const msg = fromHex('8d48e95b9915828df0089c433e2e');

	test('fields', () => {
		expect(downlinkFormat(msg)).toBe(17);
		expect(icaoAddress(msg)).toBe('48E95B');
		expect(typeCode(msg)).toBe(19);
		expect(toHex(msg)).toBe('8d48e95b9915828df0089c433e2e');
	});
});

describe('against the capture (numbers from fixtures/README.md)', () => {
	test('type codes of DF17', () => {
		const tcs: Record<number, number> = {};
		for (const f of frames) {
			const tc = typeCode(f.data);
			if (tc !== null && downlinkFormat(f.data) === 17) tcs[tc] = (tcs[tc] ?? 0) + 1;
		}
		expect(tcs).toEqual({
			0: 26,
			4: 267,
			11: 2196,
			12: 506,
			18: 61,
			19: 2747,
			28: 132,
			29: 1096,
			31: 514
		});
	});

	test('19 distinct aircraft send DF17', () => {
		const icaos = new Set(
			frames.filter((f) => downlinkFormat(f.data) === 17).map((f) => icaoAddress(f.data))
		);
		expect(icaos.size).toBe(19);
	});

	test('no ICAO address for formats that hide it in the parity', () => {
		for (const f of frames) {
			const df = downlinkFormat(f.data);
			expect(icaoAddress(f.data) === null).toBe(![11, 17, 18].includes(df));
		}
	});
});

test('signal levels', () => {
	expect(signalDbfs(255)).toBe(0);
	expect(signalDbfs(0)).toBe(-Infinity);
	expect(signalDbfs(7)).toBeCloseTo(-31.2, 1);
});

test('signal buckets: 3 dB wide, lower edge, clamped to -48 … -3', () => {
	expect(signalBucket(-2.6)).toBe(-3); // strong: at or above -3 dBFS
	expect(signalBucket(-3)).toBe(-3);
	expect(signalBucket(-3.1)).toBe(-6);
	expect(signalBucket(-20)).toBe(-21);
	expect(signalBucket(signalDbfs(1))).toBe(-48); // -48.1, the weakest possible byte
	expect(signalBucket(-Infinity)).toBe(-48);
	expect(signalBucket(0)).toBe(-3); // full scale still counts as the top bucket
});

test('containment radius only for position type codes', () => {
	expect(containmentRadius(11)).toBe('< 75 m or < 185 m');
	expect(containmentRadius(18)).toBe('unknown');
	expect(containmentRadius(5)).toBe('< 7.5 m');
	expect(containmentRadius(8)).toBe('unknown');
	for (const tc of [0, 4, 19, 23, 28, 29, 31]) expect(containmentRadius(tc)).toBeNull();
});

test('type code groups cover 0–31 exactly once, in order', () => {
	const codes = TYPE_CODE_GROUPS.flatMap((g) =>
		Array.from({ length: g.to - g.from + 1 }, (_, i) => g.from + i)
	);
	expect(codes).toEqual(Array.from({ length: 32 }, (_, i) => i));
	expect(typeCodeName(11)).toBe('Airborne position (barometric altitude)');
	expect(typeCodeName(26)).toBe('Reserved');
	expect(() => typeCodeGroup(32)).toThrow(RangeError);
});
