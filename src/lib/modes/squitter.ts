/**
 * One entry point for the ADS-B payload (ME) of DF17/18/19: picks the decoder by type code.
 * Each result has a `kind`, so callers can `switch` on it.
 *
 *   TC 0           airborne position, without a position (altitude only)
 *   TC 1–4         identification and category
 *   TC 5–8         surface position
 *   TC 9–18, 20–22 airborne position (barometric / GNSS height)
 *   TC 19          airborne velocity
 *   TC 23          test message
 *   TC 24          surface system status (reserved)
 *   TC 25–27       reserved
 *   TC 28          aircraft status (emergency, ACAS advisory)
 *   TC 29          target state and status
 *   TC 30          aircraft operational coordination (version 0 only, never used)
 *   TC 31          operational status
 *
 * Shared by server and browser; no state here.
 */
import { bits, esFormat, payload } from './frame';
import { callsign, emitterCategory, type Identification } from './identification';
import {
	airbornePosition,
	surfacePosition,
	type AirbornePosition,
	type SurfacePosition
} from './position';
import { squawk } from './squawk';
import {
	aircraftStatus,
	operationalStatus,
	targetState,
	type AircraftStatus,
	type OperationalStatus,
	type TargetState
} from './status';
import { velocity, type Velocity } from './velocity';

export type Squitter =
	| ({ kind: 'identification' } & Identification)
	| AirbornePosition
	| SurfacePosition
	| Velocity
	| AircraftStatus
	| TargetState
	| OperationalStatus
	| TestMessage
	| ReservedSquitter;

/** TC 23: for testing ADS-B equipment. Subtype 7 carries the squawk (DO-260B). */
export interface TestMessage {
	kind: 'test';
	subtype: number;
	squawk: string | null;
}

/** A type code with no defined content (yet): TC 24–27 and 30, and undefined subtypes. */
export interface ReservedSquitter {
	kind: 'reserved';
	tc: number;
}

/**
 * The ADS-B payload of a message, decoded. null if the message has no ADS-B payload: not
 * DF17/18/19, or DF18/19 with a control/application field that means a different layout
 * (esFormat in frame.ts).
 */
export function extendedSquitter(data: Uint8Array): Squitter | null {
	const me = payload(data);
	return me && esFormat(data) ? squitter(me) : null;
}

/**
 * IMF (ICAO/Mode A flag) in relayed messages (DF18 CF 2 and 6): 1 = the address is not an
 * ICAO address (TIS-B: a 12-bit Mode A code + 12-bit track number). The bit reuses a field
 * the ground station has no use for, so where it sits depends on the type code. null for
 * type codes without one.
 */
export function imf(me: Uint8Array): boolean | null {
	const tc = bits(me, 1, 5);
	const at = (bit: number) => bits(me, bit, 1) === 1;
	if (tc === 0 || (tc >= 9 && tc <= 18) || (tc >= 20 && tc <= 22)) return at(8);
	if (tc >= 5 && tc <= 8) return at(21);
	if (tc === 19) return at(9);
	if (tc === 28 || tc === 31) return at(56);
	if (tc === 29) return at(51);
	return null;
}

/**
 * The same, from the 56-bit payload alone. ADS-B messages are transponder registers too
 * (0,5 position, 0,8 identification, 0,9 velocity, …), so a radar can also read them via
 * Comm-B, and then they arrive without a DF17 around them.
 */
export function squitter(me: Uint8Array): Squitter {
	const tc = bits(me, 1, 5);
	if (tc >= 1 && tc <= 4) {
		return {
			kind: 'identification',
			callsign: callsign(me.subarray(1, 7)),
			category: emitterCategory(tc, bits(me, 6, 3))
		};
	}
	if (tc === 23) {
		const subtype = bits(me, 6, 3);
		const id = bits(me, 9, 13);
		return { kind: 'test', subtype, squawk: subtype === 7 && id ? squawk(id) : null };
	}
	return (
		airbornePosition(me) ??
		surfacePosition(me) ??
		velocity(me) ??
		aircraftStatus(me) ??
		targetState(me) ??
		operationalStatus(me) ?? { kind: 'reserved', tc }
	);
}
