import { describe, expect, test } from 'bun:test';
import { AddressFilter } from './address-filter';
import { ADDRESS_BLOCKS } from './address-blocks';
import { downlinkFormat } from './frame';
import { allocation, formatRegistration, NATIONALITY_MARKS, nationalityMark } from './nationality';
import { timedMessages } from './testing';

describe('the address blocks (ICAO Annex 10, Vol. III, Table 9-1)', () => {
	test('196 blocks of the sizes the Annex allows, each aligned to its size, none overlapping', () => {
		// Annex 10, Vol. III, Part I, Chapter 9, 2.1: a fixed pattern of the first 4, 6, 9, 11,
		// 12 or 13 bits, so 1,048,576 down to 2,048 addresses.
		const SIZES = [2048, 4096, 8192, 32_768, 262_144, 1_048_576];
		expect(ADDRESS_BLOCKS.length).toBe(196);
		let previousEnd = -1;
		for (const [from, to] of ADDRESS_BLOCKS) {
			const [start, end] = [parseInt(from, 16), parseInt(to, 16)];
			expect(SIZES).toContain(end - start + 1);
			expect(start % (end - start + 1)).toBe(0);
			expect(start).toBeGreaterThan(previousEnd);
			previousEnd = end;
		}
	});

	test('spot checks against the table', () => {
		const block = (icao: string) => {
			const a = allocation(icao)!;
			return [a.from, a.to, a.state, a.size];
		};
		expect(block('3C6586')).toEqual(['3C0000', '3FFFFF', 'Germany', 262_144]);
		expect(block('400000')).toEqual(['400000', '43FFFF', 'United Kingdom', 262_144]);
		expect(block('3BFFFF')).toEqual(['380000', '3BFFFF', 'France', 262_144]);
		expect(block('AE01D5')).toEqual(['A00000', 'AFFFFF', 'United States', 1_048_576]);
		expect(block('501234')).toEqual(['501000', '5017FF', 'Albania', 2048]);
		expect(block('F00001')).toEqual(['F00000', 'F07FFF', 'ICAO (temporary addresses)', 32_768]);
		// Between blocks, and the big unallocated ranges: no State.
		expect(allocation('000001')).toBeNull();
		expect(allocation('B00000')).toBeNull();
	});

	test('every aircraft in the capture has an allocated address', () => {
		const filter = new AddressFilter();
		const states = new Set<string>();
		for (const { t, data } of timedMessages) {
			const addr = filter.check(data, t);
			if (downlinkFormat(data) !== 17 || addr?.verdict !== 'valid') continue;
			const a = allocation(addr.icao);
			expect({ icao: addr.icao, allocated: a !== null }).toEqual({
				icao: addr.icao,
				allocated: true
			});
			states.add(a!.state);
		}
		expect(states.has('Germany')).toBe(true);
	});
});

describe('nationality marks', () => {
	test('every State in the table has one; the names match the table', () => {
		const states = new Set(ADDRESS_BLOCKS.map(([, , state]) => state));
		for (const state of Object.keys(NATIONALITY_MARKS)) expect(states).toContain(state);
		for (const [from, , state] of ADDRESS_BLOCKS) {
			const marks = allocation(from)!.marks;
			if (state.startsWith('ICAO')) continue;
			expect({ state, some: marks.length > 0 }).toEqual({ state, some: true });
		}
		// The ICAO block that Taiwan's register uses.
		expect(allocation('899123')!.marks).toEqual(['B-']);
		expect(allocation('F00001')!.marks).toEqual([]);
	});

	test('the mark the registration starts with; the longest if several fit', () => {
		const uk = allocation('400000')!.marks;
		expect(nationalityMark('GEUUA', uk)).toBe('G-');
		expect(nationalityMark('VPBAB', uk)).toBe('VP-');
		expect(nationalityMark('MYULI', uk)).toBe('M-');
		expect(nationalityMark('DAIZA', uk)).toBeNull();
		expect(nationalityMark('D', ['D-'])).toBeNull(); // the mark alone isn't a registration
		expect(nationalityMark('CFABC', ['C-', 'CF-'])).toBe('CF-');
	});

	test('the dash goes back where the State writes one', () => {
		expect(formatRegistration('DAIZA', 'D-')).toBe('D-AIZA');
		expect(formatRegistration('9HQAA', '9H-')).toBe('9H-QAA');
		expect(formatRegistration('A9CABC', 'A9C-')).toBe('A9C-ABC');
		expect(formatRegistration('N12345', 'N')).toBe('N12345');
		expect(formatRegistration('JA8089', 'JA')).toBe('JA8089');
	});
});
