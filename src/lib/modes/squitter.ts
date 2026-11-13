/**
 * One entry point for the ADS-B payload (ME) of DF17/18: picks the decoder by type code.
 * Each result has a `kind`, so callers can `switch` on it.
 *
 * Shared by server and browser; no state here.
 */
import { payload, typeCode } from './frame';
import { identification, type Identification } from './identification';
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
	const tc = typeCode(data);
	const me = payload(data);
	if (tc === null || me === null) return null;
	if (tc >= 1 && tc <= 4) return { kind: 'identification', ...identification(data)! };
	return (
		airbornePosition(me) ??
		velocity(me) ??
		aircraftStatus(me) ??
		targetState(me) ??
		operationalStatus(me)
	);
}
