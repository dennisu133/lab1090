import { expect, test } from 'bun:test';
import { fromHex } from '#lib/modes/frame.ts';
import { containmentText, describe as describeFrame, type Located } from './frame';

const position = fromHex('8d4400f858c3a2beccc74b9d3525'); // DF17 TC 11, 38,050 ft

/** The position-related values only: coordinates, distance, check. */
function positionValues(located: Located): string[] {
	return describeFrame(position, located)
		.filter((f) => /^-?\d+\.\d{4}, |km|pair|unconfirmed/.test(f.value))
		.map((f) => `${f.tone}: ${f.value}`);
}

const here = { lat: 0, lon: 0 };
const there = { lat: 0, lon: 1 }; // 111 km east

test('reference and pair agree: confirmed', () => {
	expect(positionValues({ reference: here, local: there, global: there })).toEqual([
		'main: 0.0000, 1.0000',
		'main: 111 km E',
		'minor: ✓ pair'
	]);
});

test('they disagree: the pair wins, and the row says how far off the reference decode was', () => {
	const wrongZone = { lat: 6, lon: 1 }; // one even zone north
	expect(positionValues({ reference: here, local: wrongZone, global: there })).toEqual([
		'main: 0.0000, 1.0000',
		'main: 111 km E',
		'alert: reference decode 667 km off',
		'minor: pair'
	]);
});

test('reference only: unconfirmed', () => {
	expect(positionValues({ reference: here, local: there, global: null })).toEqual([
		'main: 0.0000, 1.0000',
		'main: 111 km E',
		'minor: unconfirmed'
	]);
});

test('containment radius per position type code', () => {
	expect(containmentText(5)).toBe('< 7.5 m');
	expect(containmentText(11)).toBe('< 75 or 185 m');
	expect(containmentText(12)).toBe('< 370 m');
	expect(containmentText(13)).toBe('< 0.3, 0.5 or 0.6 NM');
	expect(containmentText(16)).toBe('< 4 or 8 NM');
	expect(containmentText(17)).toBe('< 20 NM');
	expect(containmentText(18)).toBe('unknown');
	expect(containmentText(8)).toBe('unknown, or < 0.2, 0.3 or 0.6 NM');
	expect(containmentText(19)).toBeNull();
});
