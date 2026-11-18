/**
 * The small fields at the start of each Mode S format: everything between the DF and the
 * address/parity (short formats) or the 56-bit payload (long formats). Plus the altitude or
 * squawk, which the surveillance replies carry in bits 20–32.
 *
 *   DF0  (short air-air, ACAS):    VS CC – SL – RI – AC
 *   DF16 (long air-air, ACAS):     VS – SL – RI – AC + MV (56-bit payload, see AirAirPayload)
 *   DF4/20 (altitude reply):       FS DR UM AC          (+ MB in DF20)
 *   DF5/21 (identity reply):       FS DR UM ID          (+ MB in DF21)
 *   DF11/17 (all-call reply, ES):  CA
 *   DF18 (ES, non-transponder):    CF  (who sends it, and what the address means)
 *   DF19 (military ES):            AF  (the rest: see isDf17Format in crc.ts)
 *   DF24 (Comm-D, extended length):  KE ND (+ MD, 80 bits)
 *
 * Shared by server and browser; no state here.
 */
import { resolutionAdvisory, type ResolutionAdvisory } from './acas';
import { replyAltitude, type Altitude } from './altitude';
import { bits, downlinkFormat, payload, toHex } from './frame';
import { airbornePosition, type AirbornePosition } from './position';
import { replySquawk } from './squawk';

export type Header =
	| ({ df: 0 } & AirAir)
	| ({ df: 16 } & AirAir & { mv: AirAirPayload })
	| ({ df: 4 | 20 } & ReplyStatus & { altitude: Altitude })
	| ({ df: 5 | 21 } & ReplyStatus & { squawk: string })
	| { df: 11 | 17; capability: number }
	| { df: 18; control: number }
	| { df: 19; application: number }
	| ({ df: 24 } & CommD);

/**
 * DF24: one segment of an extended length message (ELM): up to 16 segments of 80 bits,
 * sent as a burst after a radar reserved the transponder for it (DR 16–31 announce one).
 */
export interface CommD {
	/** KE: 0 = a downlink ELM segment, 1 = acknowledges an uplink ELM. */
	ke: number;
	/** ND: the segment number, 0–15. */
	nd: number;
	/** MD: the 80-bit message segment, as hex. */
	md: string;
}

/** DF0/16: replies to another aircraft's collision avoidance system (ACAS, a.k.a. TCAS). */
export interface AirAir {
	/** VS: 0 airborne, 1 on the ground. */
	onGround: boolean;
	/** CC (DF0 only): can it answer air-air requests for a register (the long DF16 reply)? */
	crossLink: boolean | null;
	/** SL: the ACAS sensitivity level, 0 = ACAS inoperative, 1–7 higher = larger protection volume. */
	sensitivity: number;
	/** RI: either ACAS capability (0–7) or, if the interrogator asked for it, max airspeed (8–15). */
	replyInfo: number;
	altitude: Altitude;
}

/**
 * DF16's MV field: the 56-bit payload of a long air-air reply. Its first 8 bits are the VDS
 * (V-definition subfield, ICAO Annex 10 Vol. IV), which says what the other 48 hold:
 *
 *   VDS 0x30:  an ACAS coordination reply, this aircraft's resolution advisory as another
 *              aircraft's ACAS asked for it (same layout as Comm-B register 3,0: acas.ts)
 *
 * In practice MV mostly holds a copy of the airborne position register (BDS 0,5), asked for
 * air-to-air: its first 5 bits then read like an ADS-B type code (9–18, 20–22).
 */
export type AirAirPayload =
	| { kind: 'acas'; advisory: ResolutionAdvisory }
	| { kind: 'position'; position: AirbornePosition }
	/** Anything else, or a position copy without a position (TC 0). */
	| { kind: 'other'; vds: number };

export function airAirPayload(mv: Uint8Array): AirAirPayload {
	const vds = bits(mv, 1, 8);
	if (vds === 0x30) return { kind: 'acas', advisory: resolutionAdvisory(mv) };
	const position = airbornePosition(mv);
	if (position && position.tc !== 0) return { kind: 'position', position };
	return { kind: 'other', vds };
}

/** DF4/5/20/21: replies to a ground radar. */
export interface ReplyStatus {
	/** FS */
	flightStatus: FlightStatus;
	/** DR: what the transponder would like to send next (0 = nothing). */
	downlinkRequest: number;
	/** UM: who has reserved the transponder for a multi-part exchange (0 = nobody). */
	utility: { iis: number; ids: number };
}

export interface FlightStatus {
	code: number;
	/** null = the code doesn't say (FS 4/5). */
	onGround: boolean | null;
	/** The squawk was changed recently (or is an emergency code). */
	alert: boolean;
	/** Special position identification: the pilot pressed IDENT, usually because ATC asked. */
	spi: boolean;
}

export function messageHeader(data: Uint8Array): Header | null {
	const df = downlinkFormat(data);
	switch (df) {
		case 0:
		case 16: {
			const airAir: AirAir = {
				onGround: bits(data, 6, 1) === 1,
				crossLink: df === 0 ? bits(data, 7, 1) === 1 : null,
				sensitivity: bits(data, 9, 3),
				replyInfo: bits(data, 14, 4),
				altitude: replyAltitude(data)
			};
			if (df === 0) return { df, ...airAir };
			const mv = payload(data);
			return mv ? { df, ...airAir, mv: airAirPayload(mv) } : null;
		}
		case 4:
		case 20:
			return { df, ...replyStatus(data), altitude: replyAltitude(data) };
		case 5:
		case 21:
			return { df, ...replyStatus(data), squawk: replySquawk(data) };
		case 11:
		case 17:
			return { df, capability: bits(data, 6, 3) };
		case 18:
			return { df, control: bits(data, 6, 3) };
		case 19:
			return { df, application: bits(data, 6, 3) };
		case 24:
			// The first two bits are "11", the third is spare: DF24 is the only 2-bit format.
			return { df, ke: bits(data, 4, 1), nd: bits(data, 5, 4), md: toHex(data.subarray(1, 11)) };
		default:
			return null;
	}
}

function replyStatus(data: Uint8Array): ReplyStatus {
	const um = bits(data, 14, 6);
	return {
		flightStatus: flightStatus(bits(data, 6, 3)),
		downlinkRequest: bits(data, 9, 5),
		utility: { iis: um >> 2, ids: um & 0b11 }
	};
}

export function flightStatus(code: number): FlightStatus {
	return {
		code,
		onGround: code === 1 || code === 3 ? true : code === 0 || code === 2 ? false : null,
		alert: code >= 2 && code <= 4,
		spi: code === 4 || code === 5
	};
}

/** CA in DF11/17: the transponder's level and whether it's airborne. */
export const CAPABILITIES: Record<number, string> = {
	0: 'Level 1 transponder',
	4: 'Level 2+, on the ground',
	5: 'Level 2+, airborne',
	6: 'Level 2+, airborne or on the ground',
	7: 'Level 2+, has something to send or alert/SPI'
};

/** CF in DF18: who sends the message, and what the address in it means. */
export const CONTROL_FIELDS: Record<number, string> = {
	0: 'ADS-B from a device without a transponder, ICAO address',
	1: 'ADS-B from a device without a transponder, non-ICAO address (anonymous, vehicle, obstacle)',
	2: 'Fine TIS-B: a ground station relaying radar traffic (IMF says what the address is)',
	3: 'Coarse TIS-B airborne position and velocity',
	4: 'TIS-B/ADS-R management message',
	5: 'Fine TIS-B, non-ICAO address',
	6: 'ADS-R: a ground station rebroadcasting ADS-B from another data link (978 MHz UAT)',
	7: 'Reserved'
};

/** RI in DF0/16. */
export const REPLY_INFO: Record<number, string> = {
	0: 'No operating ACAS',
	2: 'ACAS, resolution advisories inhibited',
	3: 'ACAS, vertical resolution advisories',
	4: 'ACAS, vertical and horizontal resolution advisories',
	8: 'No max airspeed available',
	9: 'Max airspeed ≤ 75 kt',
	10: 'Max airspeed 75–150 kt',
	11: 'Max airspeed 150–300 kt',
	12: 'Max airspeed 300–600 kt',
	13: 'Max airspeed 600–1200 kt',
	14: 'Max airspeed > 1200 kt'
};

/** DR in DF4/5/20/21. 16–31: an extended length message (ELM) of DR − 15 segments is waiting. */
export function downlinkRequestText(dr: number): string {
	if (dr >= 16) return `Extended length message waiting (${dr - 15} segments)`;
	return (
		[
			'Nothing to send',
			'Comm-B message waiting',
			'ACAS message waiting',
			'Comm-B and ACAS messages waiting',
			'Comm-B broadcast 1 waiting',
			'Comm-B broadcast 2 waiting',
			'Comm-B broadcast 1 and ACAS waiting',
			'Comm-B broadcast 2 and ACAS waiting'
		][dr] ?? 'Reserved'
	);
}

/** UM's IDS: what kind of reservation. IIS is the interrogator (radar) holding it. */
export const RESERVATION_TYPES = ['none', 'Comm-B', 'Comm-C (uplink ELM)', 'Comm-D (downlink ELM)'];
