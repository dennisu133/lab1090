import { checkParity, type Interrogator } from './crc';

/**
 * - valid:   address in the clear, CRC checks out
 * - invalid: address in the clear, CRC doesn't match (corrupted)
 * - known:   address from the parity, and we recently heard that aircraft in a valid message
 * - unknown: address from the parity, never (or not recently) heard: most likely a corrupted
 *            message that produced a random address, or an aircraft we haven't heard yet
 */
export type Verdict = 'valid' | 'invalid' | 'known' | 'unknown';

export interface Checked {
	icao: string;
	/** Where the address came from: sent in the clear, or recovered from the parity (AP). */
	source: 'clear' | 'parity';
	verdict: Verdict;
	/** DF11 only: which radar the aircraft replied to. */
	interrogator: Interrogator | null;
}

/** How long an aircraft counts as "recently heard" (readsb uses the same 60 s). */
export const ADDRESS_TTL_MS = 60_000;

/**
 * Remembers which aircraft were recently heard in messages the CRC could verify, so that
 * addresses recovered from AP parity can be checked against them. readsb does the same
 * ("ICAO filter").
 *
 * Only clear, valid messages from transponders (DF11/17) put an address on the list. An
 * AP message never
 * does, not even a "known" one: it can't prove anything about itself.
 */
export class AddressFilter {
	#lastSeen = new Map<string, number>();

	constructor(readonly ttlMs = ADDRESS_TTL_MS) {}

	/** `now` in ms, from any clock, as long as it's the same one every time. */
	check(data: Uint8Array, now: number): Checked | null {
		const p = checkParity(data);
		if (p === null) return null;
		if (p.kind === 'clear') {
			// DF18 comes from devices without a transponder, or from ground stations relaying
			// traffic (whose addresses may not even be ICAO addresses): neither can send the
			// replies this list vouches for. DF19 is military, and whether its address is an
			// ICAO address is not something we can know.
			if (p.valid && (data[0] >> 3 === 11 || data[0] >> 3 === 17)) this.#lastSeen.set(p.icao, now);
			return {
				icao: p.icao,
				source: 'clear',
				verdict: p.valid ? 'valid' : 'invalid',
				interrogator: p.interrogator
			};
		}
		const seen = this.#lastSeen.get(p.icao);
		const known = seen !== undefined && now - seen <= this.ttlMs;
		return {
			icao: p.icao,
			source: 'parity',
			verdict: known ? 'known' : 'unknown',
			interrogator: null
		};
	}

	/** Forget aircraft that weren't heard within the TTL (otherwise the map only grows). */
	prune(now: number): void {
		for (const [icao, seen] of this.#lastSeen) {
			if (now - seen > this.ttlMs) this.#lastSeen.delete(icao);
		}
	}

	/** Number of aircraft currently on the list. */
	get size(): number {
		return this.#lastSeen.size;
	}
}
