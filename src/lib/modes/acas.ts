/**
 * ACAS resolution advisories (RA): what a collision avoidance system (ACAS, a.k.a. TCAS)
 * is telling the pilots to do, right now. The same 48 bits appear in three places:
 *
 *   Comm-B register 3,0           (DF20/21 MB, bits 9–56; bits 1–8 are 0x30)
 *   ADS-B TC 28, subtype 2        (DF17 ME, bits 9–56; bits 1–8 are TC and subtype)
 *   DF16 coordination reply       (MV, bits 9–56; bits 1–8 are VDS 0x30)
 *
 * Layout (bit numbers within the 56-bit field):
 *
 *   ARA (14, bits 9–22) | RAC (4) | RAT (1) | MTE (1) | TTI (2) | TID (26)
 *
 * Shared by server and browser; no state here.
 */
import { altitudeCode } from './altitude';
import { bits } from './frame';

export interface ResolutionAdvisory {
	/** ARA bits 9–15: the advice ACAS is giving the pilots right now. */
	active: boolean;
	corrective: boolean;
	downward: boolean;
	increasedRate: boolean;
	senseReversal: boolean;
	altitudeCrossing: boolean;
	positive: boolean;
	/** RAC bits 23–26: what another aircraft's ACAS told this one not to do. */
	noBelow: boolean;
	noAbove: boolean;
	/** Horizontal advisories: defined, but no ACAS II issues them. */
	noLeft: boolean;
	noRight: boolean;
	/** Bit 27 (RAT): the advisory just ended. */
	terminated: boolean;
	/** Bit 28 (MTE): more than one threat. */
	multipleThreats: boolean;
	/** Bits 31–56, by threat type (TTI, bits 29–30). */
	threat:
		| { type: 'address'; icao: string }
		| { type: 'position'; altitude: number | null; rangeNm: number | null; bearing: number | null }
		| null;
}

const flag = (field: Uint8Array, bit: number) => bits(field, bit, 1) === 1;

/** Reads bits 9–56 of a 56-bit field; bits 1–8 (whatever identifies the field) are ignored. */
export function resolutionAdvisory(field: Uint8Array): ResolutionAdvisory {
	const tti = bits(field, 29, 2);
	const range = bits(field, 44, 7);
	const bearing = bits(field, 51, 6);
	return {
		active: flag(field, 9),
		corrective: flag(field, 10),
		downward: flag(field, 11),
		increasedRate: flag(field, 12),
		senseReversal: flag(field, 13),
		altitudeCrossing: flag(field, 14),
		positive: flag(field, 15),
		noBelow: flag(field, 23),
		noAbove: flag(field, 24),
		noLeft: flag(field, 25),
		noRight: flag(field, 26),
		terminated: flag(field, 27),
		multipleThreats: flag(field, 28),
		threat:
			tti === 1
				? { type: 'address', icao: bits(field, 31, 24).toString(16).toUpperCase().padStart(6, '0') }
				: tti === 2
					? {
							type: 'position',
							altitude: altitudeCode(bits(field, 31, 13)).feet,
							rangeNm: range === 0 ? null : (range - 1) / 10,
							bearing: bearing === 0 ? null : 6 * (bearing - 1) + 3
						}
					: null
	};
}
