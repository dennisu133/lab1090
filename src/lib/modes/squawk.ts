/**
 * The squawk, or Mode A code: 4 octal digits (0000–7777) that air traffic control assigns
 * to a flight. Sent in the 13-bit ID field of DF5/21 and in ADS-B aircraft status (TC 28).
 *
 * Like the altitude code, the layout is inherited from Mode A's pulse slots:
 *
 *   C1 A1 C2 A2 C4 A4 X B1 D1 B2 D2 B4 D4
 *
 * Each digit is three of those bits: A = A4 A2 A1, B = B4 B2 B1, and so on. That's why the
 * digits only go to 7. X is always 0.
 *
 * Shared by server and browser; no state here.
 */

export function squawk(id13: number): string {
	const bit = (index: number) => (id13 >> (12 - index)) & 1;
	const digit = (four: number, two: number, one: number) =>
		(bit(four) << 2) | (bit(two) << 1) | bit(one);
	const a = digit(5, 3, 1);
	const b = digit(11, 9, 7);
	const c = digit(4, 2, 0);
	const d = digit(12, 10, 8);
	return `${a}${b}${c}${d}`;
}

/** DF5/21: the ID field, message bits 20–32. */
export function replySquawk(data: Uint8Array): string {
	return squawk(((data[2] & 0x1f) << 8) | data[3]);
}

/** Codes with a fixed meaning (worldwide, plus the common European ones). */
export const SPECIAL_SQUAWKS: Record<string, { meaning: string; emergency: boolean }> = {
	'7500': { meaning: 'Unlawful interference (hijack)', emergency: true },
	'7600': { meaning: 'Radio failure', emergency: true },
	'7700': { meaning: 'Emergency', emergency: true },
	'1000': {
		meaning: 'Mode S conspicuity code: ATC identifies the flight by its callsign instead',
		emergency: false
	},
	'2000': { meaning: 'Entering controlled airspace without an assigned code', emergency: false },
	'7000': { meaning: 'VFR, not talking to ATC (Europe)', emergency: false },
	'1200': { meaning: 'VFR (North America)', emergency: false }
};
