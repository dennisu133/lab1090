/**
 * Mode S parity: a 24-bit CRC over the message, sent in its last 3 bytes.
 *
 * How it's used depends on the format:
 *
 * - DF17/18 (PI): parity = CRC. Recomputing it and XORing with the received parity gives
 *   the *syndrome*: 0 for an intact message.
 * - DF11 (PI): parity = CRC XOR interrogator code. The syndrome is the code of the radar the
 *   aircraft is replying to (0 when it's broadcasting on its own), always < 128.
 * - DF0/4/5/16/20/21/24 (AP): parity = CRC XOR aircraft address. These messages don't carry
 *   the address anywhere else, so the syndrome *is* the address. The price: a corrupted
 *   message just yields a different, wrong address. It can only be trusted if that address
 *   was also heard in a CRC-checked format (see AddressFilter).
 *
 * Shared by server and browser; no state here.
 */

/**
 * The generator polynomial: x²⁴ + x²³ + … + x¹⁰ + x³ + 1, i.e. 0x1FFF409. The x²⁴ term
 * is implied by the 24-bit register (it's the bit that falls off the top), so only the lower
 * 24 bits appear here.
 */
export const GENERATOR = 0xfff409;

/**
 * CRC of each possible byte value, so crc24 can work a byte at a time instead of a bit at a
 * time. Each entry is built with the textbook bitwise algorithm: shift left, and whenever
 * a 1 falls off the top, XOR in the generator (polynomial long division in base 2).
 */
const TABLE = Uint32Array.from({ length: 256 }, (_, byte) => {
	let crc = byte << 16;
	for (let bit = 0; bit < 8; bit++) {
		crc = crc & 0x800000 ? (crc << 1) ^ GENERATOR : crc << 1;
	}
	return crc & 0xffffff;
});

/** CRC-24 of the first `length` bytes. */
export function crc24(bytes: Uint8Array, length = bytes.length): number {
	let crc = 0;
	for (let i = 0; i < length; i++) {
		crc = ((crc << 8) & 0xffffff) ^ TABLE[(crc >> 16) ^ bytes[i]];
	}
	return crc;
}

/** The parity field: the last 24 bits of the message (PI or AP). */
export function parityField(data: Uint8Array): number {
	const n = data.length;
	return (data[n - 3] << 16) | (data[n - 2] << 8) | data[n - 1];
}

/** CRC of everything before the parity, XORed with the parity that was received. */
export function syndrome(data: Uint8Array): number {
	return crc24(data, data.length - 3) ^ parityField(data);
}

/** Formats whose parity is overlaid with the aircraft address. */
const AP_FORMATS = new Set([0, 4, 5, 16, 20, 21, 24]);

export type ParityResult =
	/** Address sent in the clear (DF11/17/18): the CRC can actually check the message. */
	| { kind: 'clear'; icao: string; valid: boolean; interrogator: Interrogator | null }
	/** Address recovered from the parity (AP): unverifiable on its own. */
	| { kind: 'parity'; icao: string };

/**
 * Who the message is from, and what the CRC says about it. `null` for formats without
 * a (known) address field, e.g. DF19 (military) or undefined formats.
 */
export function checkParity(data: Uint8Array): ParityResult | null {
	const df = Math.min(data[0] >> 3, 24);
	const s = syndrome(data);
	if (df === 17 || df === 18) {
		return { kind: 'clear', icao: hex24(clearAddress(data)), valid: s === 0, interrogator: null };
	}
	if (df === 11) {
		// Only the lowest 7 bits may be non-zero: they hold the interrogator code.
		const valid = (s & ~0x7f) === 0;
		return {
			kind: 'clear',
			icao: hex24(clearAddress(data)),
			valid,
			interrogator: valid ? interrogator(s) : null
		};
	}
	if (AP_FORMATS.has(df)) return { kind: 'parity', icao: hex24(s) };
	return null;
}

/**
 * The radar a DF11 all-call reply answers, from the 7-bit code in its syndrome:
 * a 3-bit code label (CL) and a 4-bit interrogator code (IC).
 *   CL 0:   II, an "interrogator identifier" 0–15. II 0 with no radar asking = a squitter,
 *           the aircraft announcing itself (about once a second).
 *   CL 1–4: SI, a "surveillance identifier" 1–63, for radars that need more than 16 codes.
 *   CL 5–7 (and SI 0): not defined. A bit error in the last 7 parity bits looks like this: those bits only
 *           carry the code, so the CRC can't tell; the address is still correct.
 */
export type Interrogator = { type: 'II' | 'SI'; code: number } | { type: 'invalid'; code: number };

export function interrogator(code: number): Interrogator {
	const cl = code >> 4;
	const ic = code & 0xf;
	if (cl === 0) return { type: 'II', code: ic };
	const si = (cl - 1) * 16 + ic;
	if (cl <= 4 && si > 0) return { type: 'SI', code: si };
	return { type: 'invalid', code };
}

function clearAddress(data: Uint8Array): number {
	return (data[1] << 16) | (data[2] << 8) | data[3];
}

function hex24(n: number): string {
	return n.toString(16).toUpperCase().padStart(6, '0');
}
