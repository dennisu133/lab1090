/**
 * Which decoded bit strings are real messages?
 *
 * The demodulator tries thousands of places a second that look a little like a preamble:
 * nearly all are noise, or the middle of another message. Each gives 56 or 112 bits, and
 * only the parity can tell a message from garbage (crc.ts explains it per format). What
 * passes here goes to the server like a frame from readsb.
 *
 * - DF17/18 (ADS-B) and DF11 squitters: the CRC must come out at 0. Random bits pass once in
 *   16.7 million (2²⁴) tries.
 * - DF11 replies to a radar: the syndrome is the radar's 7-bit code, so 128 syndromes pass,
 *   and noise would get through 128 times as often (several times an hour, each with an
 *   invented address). So only from an aircraft already heard.
 * - DF0/4/5/16/20/21/24: the parity is overlaid with the address, so every bit string
 *   "passes" with some address. Only from an aircraft already heard: noise matching one of a
 *   few dozen known addresses is a one-in-a-million chance per try. That also keeps out
 *   replies from aircraft whose squitters we can't hear: readsb does the same.
 * - One flipped bit in an ADS-B message: each of the 112 bit positions gives its own
 *   syndrome, so a syndrome on that list says which bit to flip back. But noise lands on
 *   one of the 107 entries once in ~150,000 tries, which would be several false messages
 *   an hour. So a repaired message only counts from an aircraft already heard intact.
 * - A wrong bit in the format of an ADS-B message turns DF17 into 16, 19, 21 or 25, read
 *   under the wrong rules. If flipping that bit back gives CRC 0, it was DF17 (readsb's
 *   fixDF does the same). Also only from an aircraft already heard intact.
 * - The same for a DF11 squitter (code 0), with the 51 entries of a 56-bit message. Only
 *   when the syndrome isn't itself a radar's code: a wrong bit among the last 7 turns one
 *   code into another, and nothing tells which was sent. That's also why a DF11 reply's code
 *   is less certain than the rest of it: readsb has the same problem.
 *
 * "Already heard" means a DF11 or DF17 with CRC 0 within the last 60 s (like
 * address-filter.ts, which the server still applies to every frame on top of this).
 */
import { syndrome } from '#lib/modes/crc.ts';

/** How long an address counts as heard, in seconds of samples (readsb: 60 s too). */
export const KNOWN_FOR_S = 60;

/** Formats whose parity is overlaid with the aircraft's address. */
const AP_FORMATS = new Set([0, 4, 5, 16, 20, 21, 24]);

/** The downlink formats that exist; anything else is noise. */
export const KNOWN_FORMATS = new Set([0, 4, 5, 11, 16, 17, 18, 19, 20, 21, 24]);

/** Bits in a message of this format: 56 for DF0–15, 112 from DF16 on. */
export function messageBits(df: number): 56 | 112 {
	return df >= 16 ? 112 : 56;
}

/**
 * The syndrome a single wrong bit leaves, for every bit of a message of this many bytes: the
 * CRC is linear, so a flipped bit's syndrome doesn't depend on the rest of the message. Bits
 * 1–5 (the format) are left out: a message whose format is wrong was checked against the
 * wrong rules to begin with (but see FROM_17).
 */
function oneBit(bytes: number): Map<number, number> {
	const table = new Map<number, number>();
	for (let bit = 6; bit <= bytes * 8; bit++) {
		const data = new Uint8Array(bytes);
		data[(bit - 1) >> 3] = 0x80 >> ((bit - 1) & 7);
		table.set(syndrome(data), bit);
	}
	return table;
}
const ONE_BIT = oneBit(14);
const ONE_BIT_SHORT = oneBit(7);

/**
 * The formats DF17 becomes with one wrong bit, and that bit, with the syndrome it leaves in
 * a long message. (DF1 too, but that's read as 56 bits and never gets here.)
 */
const FROM_17 = new Map<number, { bit: number; syndrome: number }>();
for (let bit = 1; bit <= 5; bit++) {
	const df = 17 ^ (0x10 >> (bit - 1));
	if (messageBits(df) === 112) {
		const data = new Uint8Array(14);
		data[0] = 0x80 >> (bit - 1);
		FROM_17.set(df, { bit, syndrome: syndrome(data) });
	}
}

/**
 * Why a bit string was turned down. `parity`: the parity bits don't fit the message (no
 * repair either): noise, or a message broken in more than one place. `unheard`: the parity
 * could fit, but only for an aircraft not heard intact within KNOWN_FOR_S, which for AP
 * formats (whose parity always "fits" some address) is how nearly all noise ends.
 */
export type Rejection = 'parity' | 'unheard';

export interface FilterStats {
	/** Passed with CRC 0 (or a radar's code) as received. */
	accepted: number;
	/** ADS-B or a DF11 squitter with one bit repaired (in ADS-B, the format's too). */
	repaired: number;
}

export class MessageFilter {
	readonly stats: FilterStats = { accepted: 0, repaired: 0 };
	/** Why the last check returned null; null after one that passed. */
	rejection: Rejection | null = null;
	/** Address → when it was last heard intact, s. */
	#known = new Map<number, number>();
	#lastPrune = 0;

	/**
	 * The message to pass on (`data` itself, or a repaired copy), or null for noise. `t`: the
	 * message's time in seconds on any steady clock (the demodulator uses its sample count).
	 */
	check(data: Uint8Array, t: number): Uint8Array | null {
		if (t - this.#lastPrune > KNOWN_FOR_S) this.#prune(t);
		this.rejection = null;
		const df = Math.min(data[0] >> 3, 24);
		const s = syndrome(data);
		const from17 = data.length === 14 ? FROM_17.get(data[0] >> 3) : undefined;
		if (from17 && s === from17.syndrome) return this.#repair(data, from17.bit, t);
		if (df === 17 || df === 18 || df === 19) {
			if (s === 0) {
				if (df === 17) this.#heard(address(data), t);
				return this.#accept(data);
			}
			if (df === 19) return this.#reject('parity');
			return this.#repair(data, ONE_BIT.get(s), t);
		}
		if (df === 11) {
			if (s === 0) {
				this.#heard(address(data), t);
				return this.#accept(data);
			}
			// A radar's code, or one wrong bit?
			if ((s & ~0x7f) === 0)
				return this.#isKnown(address(data), t) ? this.#accept(data) : this.#reject('unheard');
			return this.#repair(data, ONE_BIT_SHORT.get(s), t);
		}
		if (AP_FORMATS.has(df))
			return this.#isKnown(s, t) ? this.#accept(data) : this.#reject('unheard');
		return this.#reject('parity');
	}

	/** Addresses heard intact within KNOWN_FOR_S. */
	get known(): number {
		return this.#known.size;
	}

	/** Flip `bit` back, if there is one, and pass it on if the address was heard intact. */
	#repair(data: Uint8Array, bit: number | undefined, t: number): Uint8Array | null {
		if (bit === undefined) return this.#reject('parity');
		const fixed = data.slice();
		fixed[(bit - 1) >> 3] ^= 0x80 >> ((bit - 1) & 7);
		if (!this.#isKnown(address(fixed), t)) return this.#reject('unheard');
		this.stats.repaired++;
		return fixed;
	}

	#accept(data: Uint8Array): Uint8Array {
		this.stats.accepted++;
		return data;
	}

	#reject(why: Rejection): null {
		this.rejection = why;
		return null;
	}

	#heard(icao: number, t: number): void {
		this.#known.set(icao, t);
	}

	#isKnown(icao: number, t: number): boolean {
		const seen = this.#known.get(icao);
		return seen !== undefined && t - seen <= KNOWN_FOR_S;
	}

	#prune(t: number): void {
		this.#lastPrune = t;
		for (const [icao, seen] of this.#known) if (t - seen > KNOWN_FOR_S) this.#known.delete(icao);
	}
}

/** The address sent in the clear (bits 9–32) of DF11/17/18. */
function address(data: Uint8Array): number {
	return (data[1] << 16) | (data[2] << 8) | data[3];
}
