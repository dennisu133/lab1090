/**
 * ADS-B aircraft identification (DF17/18, type codes 1–4): the callsign and the emitter
 * category, i.e. what kind of thing is transmitting.
 *
 * ME field (56 bits, bytes 4–10 of the message):
 *
 *   TC (5) | CA (3) | C1 (6) | C2 (6) | … | C8 (6)
 *
 * Shared by server and browser; no state here.
 */
import { typeCode } from './frame';

export interface Identification {
	/** Up to 8 characters, padding removed, e.g. "DLH4LW". May contain '#' for invalid characters. */
	callsign: string;
	category: EmitterCategory;
}

export interface EmitterCategory {
	/** A–D, from the type code: TC 4 = A, 3 = B, 2 = C, 1 = D. */
	set: 'A' | 'B' | 'C' | 'D';
	/** The CA field, 0–7. 0 always means "no information". */
	code: number;
	name: string;
}

export function identification(data: Uint8Array): Identification | null {
	const tc = typeCode(data);
	if (tc === null || tc < 1 || tc > 4) return null;
	return {
		callsign: callsign(data.subarray(5, 11)),
		category: emitterCategory(tc, data[4] & 0b111)
	};
}

/**
 * 8 characters of 6 bits each, in 6 bytes. Each 6-bit value is the lower 6 bits of the
 * character's ASCII code: 'A' = 0x41 -> 1, '0' = 0x30 -> 48, ' ' = 0x20 -> 32. Letters
 * get their 0x40 back; digits and space are already complete. Everything else is invalid.
 *
 * Shared with Comm-B register 2,0, which carries the callsign in the same encoding.
 */
export function callsign(bytes: Uint8Array): string {
	// Two 24-bit halves, 4 characters each: plain numbers, no BigInt needed.
	const halves = [
		(bytes[0] << 16) | (bytes[1] << 8) | bytes[2],
		(bytes[3] << 16) | (bytes[4] << 8) | bytes[5]
	];
	let s = '';
	for (const half of halves) {
		for (let shift = 18; shift >= 0; shift -= 6) s += character((half >> shift) & 0b111111);
	}
	return s.trim();
}

export function character(code: number): string {
	if (code >= 1 && code <= 26) return String.fromCharCode(code | 0x40); // A–Z
	if (code === 32 || (code >= 48 && code <= 57)) return String.fromCharCode(code); // space, 0–9
	return '#';
}

/** Names from DO-260B, Table A-2-8. Weights are maximum take-off weight. */
const CATEGORIES: Record<EmitterCategory['set'], string[]> = {
	A: [
		'No category information',
		'Light (< 7 t)',
		'Small (7–34 t)',
		'Large (34–136 t)',
		'High vortex large (e.g. B757)',
		'Heavy (> 136 t)',
		'High performance (> 5 g, > 400 kt)',
		'Rotorcraft'
	],
	B: [
		'No category information',
		'Glider / sailplane',
		'Lighter-than-air',
		'Parachutist / skydiver',
		'Ultralight / hang glider / paraglider',
		'Reserved',
		'Unmanned aerial vehicle',
		'Space / transatmospheric vehicle'
	],
	C: [
		'No category information',
		'Surface vehicle: emergency',
		'Reserved',
		'Surface vehicle: service',
		'Point obstacle',
		'Cluster obstacle',
		'Line obstacle',
		'Reserved'
	],
	D: Array.from({ length: 8 }, (_, i) => (i === 0 ? 'No category information' : 'Reserved'))
};

export function emitterCategory(tc: number, code: number): EmitterCategory {
	const set = (['D', 'C', 'B', 'A'] as const)[tc - 1];
	return { set, code, name: CATEGORIES[set][code] };
}
