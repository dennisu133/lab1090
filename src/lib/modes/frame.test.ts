import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BeastParser } from '#lib/server/beast/parser.ts';
import { downlinkFormat, fromHex, icaoAddress, signalDbfs, toHex, typeCode } from './frame';

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
