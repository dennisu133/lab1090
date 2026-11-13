/**
 * One entry point for the ADS-B payload (ME) of DF17/18: picks the decoder by type code.
 * Each result has a `kind`, so callers can `switch` on it.
 *
 * Shared by server and browser; no state here.
 */
import { bits, payload, typeCode } from './frame';
import { callsign, emitterCategory, type Identification } from './identification';
import { airbornePosition, type AirbornePosition } from './position';
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
	| Velocity
	| AircraftStatus
	| TargetState
	| OperationalStatus;

/** null for non-ADS-B formats and for type codes not decoded (yet): surface positions, reserved. */
export function extendedSquitter(data: Uint8Array): Squitter | null {
	const me = payload(data);
	return typeCode(data) === null || me === null ? null : squitter(me);
}

/**
 * The same, from the 56-bit payload alone. ADS-B messages are transponder registers too
 * (0,5 position, 0,8 identification, 0,9 velocity, …), so a radar can also read them via
 * Comm-B, and then they arrive without a DF17 around them.
 */
export function squitter(me: Uint8Array): Squitter | null {
	const tc = bits(me, 1, 5);
	if (tc >= 1 && tc <= 4) {
		return {
			kind: 'identification',
			callsign: callsign(me.subarray(1, 7)),
			category: emitterCategory(tc, bits(me, 6, 3))
		};
	}
	return (
		airbornePosition(me) ??
		velocity(me) ??
		aircraftStatus(me) ??
		targetState(me) ??
		operationalStatus(me)
	);
}
