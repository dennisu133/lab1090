/**
 * The small fields at the start of each Mode S format: everything between the DF and the
 * address/parity (short formats) or the 56-bit payload (long formats). Plus the altitude or
 * squawk, which the surveillance replies carry in bits 20–32.
 *
 *   DF0  (short air-air, ACAS):    VS CC – SL – RI – AC
 *   DF16 (long air-air, ACAS):     VS – SL – RI – AC + MV (56-bit payload)
 *   DF4/20 (altitude reply):       FS DR UM AC          (+ MB in DF20)
 *   DF5/21 (identity reply):       FS DR UM ID          (+ MB in DF21)
 *   DF11/17 (all-call reply, ES):  CA
 *
 * Shared by server and browser; no state here.
 */
import { replyAltitude, type Altitude } from './altitude';
import { bits, downlinkFormat } from './frame';
import { replySquawk } from './squawk';

export type Header =
	| ({ df: 0 | 16 } & AirAir)
	| ({ df: 4 | 20 } & ReplyStatus & { altitude: Altitude })
	| ({ df: 5 | 21 } & ReplyStatus & { squawk: string })
	| { df: 11 | 17; capability: number };

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
		case 16:
			return {
				df,
				onGround: bits(data, 6, 1) === 1,
				crossLink: df === 0 ? bits(data, 7, 1) === 1 : null,
				sensitivity: bits(data, 9, 3),
				replyInfo: bits(data, 14, 4),
				altitude: replyAltitude(data)
			};
		case 4:
		case 20:
			return { df, ...replyStatus(data), altitude: replyAltitude(data) };
		case 5:
		case 21:
			return { df, ...replyStatus(data), squawk: replySquawk(data) };
		case 11:
		case 17:
			return { df, capability: bits(data, 6, 3) };
		default:
			return null; // DF18's equivalent field (CF) means something else; DF19/24: not decoded
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
