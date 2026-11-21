/**
 * Barometric altitude, as encoded in the 13-bit AC field (DF0/4/16/20) and the 12-bit
 * altitude field of ADS-B airborne positions (TC 9–18).
 *
 * The bit order looks scrambled because it's inherited from Mode C, the 1960s radar reply.
 * There, each bit was one pulse in a fixed slot, named after its position (A1, A2, A4, B1, …).
 * Mode S kept the names and the order:
 *
 *   C1 A1 C2 A2 C4 A4 M B1 Q B2 D2 B4 D4      (index 0–12, most significant first)
 *
 * Two bits decide how to read the rest:
 *   M = 1: metric units. Not used in practice; not decoded.
 *   Q = 1: the 11 other bits are a plain binary number N, altitude = N × 25 − 1000 ft.
 *          Modern transponders all do this.
 *   Q = 0: the old Mode C Gillham code in 100 ft steps (used above 50,175 ft, and by old
 *          altitude encoders). Here the Q position is the D1 pulse.
 *
 * Altitudes are "pressure altitude": what the altimeter shows with the standard setting
 * 1013.25 hPa, not the height above the sea. Every aircraft uses the same reference,
 * which is what matters for keeping them apart.
 *
 * Shared by server and browser; no state here.
 */

export interface Altitude {
	/** Feet; null when not available (code 0), metric, or an invalid Gillham code. */
	feet: number | null;
	encoding: 'none' | '25 ft' | 'Gillham' | 'metric' | 'GNSS';
}

/** Index of the M and Q bits in the 13-bit field, counted from the most significant bit. */
const M = 6;
const Q = 8;

/** Bit `index` (0 = most significant) of a 13-bit code. */
function bit(code: number, index: number): number {
	return (code >> (12 - index)) & 1;
}

export function altitudeCode(ac13: number): Altitude {
	if (ac13 === 0) return { feet: null, encoding: 'none' };
	if (bit(ac13, M)) return { feet: null, encoding: 'metric' };

	if (bit(ac13, Q)) {
		// Remove M and Q, keep the order of the other 11 bits.
		let n = 0;
		for (let i = 0; i < 13; i++) if (i !== M && i !== Q) n = n * 2 + bit(ac13, i);
		return { feet: n * 25 - 1000, encoding: '25 ft' };
	}
	return { feet: gillham(ac13), encoding: 'Gillham' };
}

/**
 * The Mode C Gillham code. Two counters, each a Gray code (consecutive values differ in
 * exactly one bit, so a reading taken while the encoder moves is never off by more than
 * one step):
 *
 *   D2 D4 A1 A2 A4 B1 B2 B4 -> 500 ft steps
 *   C1 C2 C4                -> 100 ft steps within those 500 ft: 1–5 (0, 5, 6 invalid in Gray)
 *
 * Like the digits of an odometer that reverses direction: when the 500 ft counter is odd,
 * the 100 ft counter counts down. The −1300 makes the lowest code −1200 ft.
 */
function gillham(ac13: number): number | null {
	const [c1, a1, c2, a2, c4, a4, , b1, , b2, d2, b4, d4] = Array.from({ length: 13 }, (_, i) =>
		bit(ac13, i)
	);
	const n500 = fromGray([d2, d4, a1, a2, a4, b1, b2, b4]);
	let n100 = fromGray([c1, c2, c4]);
	if (n100 === 0 || n100 === 5 || n100 === 6) return null;
	if (n100 === 7) n100 = 5;
	if (n500 % 2) n100 = 6 - n100;
	return n500 * 500 + n100 * 100 - 1300;
}

/** Gray code to binary: each binary bit is the XOR of all Gray bits up to it. */
function fromGray(grayBits: number[]): number {
	let n = 0;
	let b = 0;
	for (const g of grayBits) {
		b ^= g;
		n = n * 2 + b;
	}
	return n;
}

/** DF0/4/16/20: the AC field, message bits 20–32. */
export function replyAltitude(data: Uint8Array): Altitude {
	return altitudeCode(((data[2] & 0x1f) << 8) | data[3]);
}

/**
 * ADS-B airborne position (TC 9–18): the 12-bit field has no M bit (ADS-B is always feet).
 * Put a 0 back where M would be, then it's the same code.
 */
export function squitterAltitude(ac12: number): Altitude {
	return altitudeCode(((ac12 >> 6) << 7) | (ac12 & 0x3f));
}

/**
 * The fastest altitude change believed between two readings: steeper than any normal
 * descent (an emergency descent is 6,000–8,000 ft/min), plus 500 ft for the 100 ft steps
 * of the old Gillham code and the time between replies.
 */
const MAX_FT_PER_MIN = 10_000;
const ALTITUDE_SLACK_FT = 500;

/**
 * Can one aircraft have been at both altitudes (ft, at times t in ms)? How a radar reply's
 * altitude finds the second opinion it needs (tracker.ts #fromReply, weather/pipeline.ts):
 * a reply that noise corrupted can still carry a known aircraft's address.
 */
export function altitudesAgree(a: { feet: number; t: number }, b: { feet: number; t: number }) {
	return (
		Math.abs(a.feet - b.feet) <= ALTITUDE_SLACK_FT + (MAX_FT_PER_MIN * Math.abs(a.t - b.t)) / 60_000
	);
}
