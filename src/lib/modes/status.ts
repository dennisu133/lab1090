/**
 * The ADS-B status messages: what the aircraft says about itself rather than where it is.
 *
 *   TC 28  Aircraft status:          emergency state and squawk (subtype 1)
 *   TC 29  Target state and status:  what the autopilot is set to (ADS-B v2, subtype 1)
 *   TC 31  Operational status:       ADS-B version, capabilities, accuracy and integrity
 *
 * Shared by server and browser; no state here.
 */
import { bits } from './frame';
import { squawk } from './squawk';

// ---------------------------------------------------------------------------------------
// TC 28: TC (5) | ST (3) | emergency (3) | ID (13) | reserved (32)

export interface AircraftStatus {
	kind: 'aircraft-status';
	/** 1: emergency/priority status. 2: a copy of an active ACAS resolution advisory (not decoded yet). */
	subtype: number;
	/** Subtype 1 only. */
	emergency: number | null;
	squawk: string | null;
}

export function aircraftStatus(me: Uint8Array): AircraftStatus | null {
	if (bits(me, 1, 5) !== 28) return null;
	const subtype = bits(me, 6, 3);
	const st1 = subtype === 1;
	return {
		kind: 'aircraft-status',
		subtype,
		emergency: st1 ? bits(me, 9, 3) : null,
		squawk: st1 ? squawk(bits(me, 12, 13)) : null
	};
}

export const EMERGENCY_STATES = [
	'No emergency',
	'General emergency',
	'Medical emergency',
	'Minimum fuel',
	'No communications',
	'Unlawful interference',
	'Downed aircraft',
	'Reserved'
];

// ---------------------------------------------------------------------------------------
// TC 29, subtype 1 (DO-260B):
//
//   TC (5) | ST (2) | SIL-S (1) | SRC (1) | SEL ALT (11) | QNH (9) | HDG-S (1) | HDG (9)
//   | NACp (4) | NICbaro (1) | SIL (2) | MODE-S (1) | AP VNAV ALT IMF APP TCAS LNAV (7) | (2)

export interface TargetState {
	kind: 'target-state';
	subtype: number;
	/** The altitude the pilot dialled in on the glareshield (MCP/FCU) or the FMS plans. */
	selectedAltitude: { feet: number; source: 'MCP/FCU' | 'FMS' } | null;
	/** The altimeter setting in hPa: 1013.2 = standard (above the transition altitude). */
	qnh: number | null;
	/** Degrees. */
	selectedHeading: number | null;
	nacP: number;
	nicBaro: number;
	sil: number;
	/** Autopilot modes; null if the aircraft doesn't report them. */
	modes: {
		autopilot: boolean;
		vnav: boolean;
		altitudeHold: boolean;
		approach: boolean;
		lnav: boolean;
	} | null;
	tcasOperational: boolean;
}

export function targetState(me: Uint8Array): TargetState | null {
	if (bits(me, 1, 5) !== 29) return null;
	const alt = bits(me, 10, 11);
	const qnh = bits(me, 21, 9);
	const flag = (bit: number) => bits(me, bit, 1) === 1;
	return {
		kind: 'target-state',
		subtype: bits(me, 6, 2),
		selectedAltitude:
			alt === 0 ? null : { feet: (alt - 1) * 32, source: flag(9) ? 'FMS' : 'MCP/FCU' },
		// round(): 800 + n × 0.8 isn't exact in floating point.
		qnh: qnh === 0 ? null : Math.round((800 + (qnh - 1) * 0.8) * 10) / 10,
		selectedHeading: flag(30) ? (bits(me, 31, 9) * 360) / 512 : null,
		nacP: bits(me, 40, 4),
		nicBaro: bits(me, 44, 1),
		sil: bits(me, 45, 2),
		modes: flag(47)
			? {
					autopilot: flag(48),
					vnav: flag(49),
					altitudeHold: flag(50),
					approach: flag(52),
					lnav: flag(54)
				}
			: null,
		tcasOperational: flag(53)
	};
}

// ---------------------------------------------------------------------------------------
// TC 31 (airborne, subtype 0):
//
//   TC (5) | ST (3) | capability class (16) | operational mode (16) | version (3)
//   | NIC-A (1) | NACp (4) | GVA (2) | SIL (2) | NICbaro (1) | HRD (1) | SIL-S (1) | (1)

export interface OperationalStatus {
	kind: 'operational-status';
	subtype: 'airborne' | 'surface' | number;
	/** 0 = DO-260, 1 = DO-260A, 2 = DO-260B. Decides how other messages are read. */
	version: number;
	/** Picks between the two Rc values of TC 11, 13 and 16. */
	nicSupplementA: number;
	nacP: number;
	sil: number;
	/** SIL is a probability per flight hour (0) or per sample (1). v2 only. */
	silSupplement: number | null;
	/** Headings (TC 19 subtype 3/4) are relative to true north (0) or magnetic north (1). */
	hrd: 'true' | 'magnetic';
	/** Airborne, ADS-B v2: the individual capability and mode bits. null otherwise. */
	capabilities: {
		tcasOperational: boolean;
		/** Can receive 1090 MHz ADS-B itself ("ADS-B In"). */
		es1090In: boolean;
		/** Can send air-referenced velocity reports (TC 19 subtype 3/4). */
		arv: boolean;
		/** Can send target state reports (TC 29). */
		ts: boolean;
		/** Can send trajectory change reports: 0 no, 1 one, 2 several. */
		tc: number;
		/** Can receive 978 MHz UAT (the US's second ADS-B frequency). */
		uatIn: boolean;
	} | null;
	modes: {
		raActive: boolean;
		ident: boolean;
		singleAntenna: boolean;
		/** System design assurance, 0–3: how well the ADS-B equipment is certified. */
		sda: number;
	} | null;
	raw: { capabilityClass: number; operationalMode: number };
}

export function operationalStatus(me: Uint8Array): OperationalStatus | null {
	if (bits(me, 1, 5) !== 31) return null;
	const st = bits(me, 6, 3);
	const version = bits(me, 41, 3);
	const flag = (bit: number) => bits(me, bit, 1) === 1;
	const detailed = st === 0 && version === 2;
	return {
		kind: 'operational-status',
		subtype: st === 0 ? 'airborne' : st === 1 ? 'surface' : st,
		version,
		nicSupplementA: bits(me, 44, 1),
		nacP: bits(me, 45, 4),
		sil: bits(me, 51, 2),
		silSupplement: version === 2 ? bits(me, 55, 1) : null,
		hrd: flag(54) ? 'magnetic' : 'true',
		capabilities: detailed
			? {
					tcasOperational: flag(11),
					es1090In: flag(12),
					arv: flag(15),
					ts: flag(16),
					tc: bits(me, 17, 2),
					uatIn: flag(19)
				}
			: null,
		modes: detailed
			? { raActive: flag(27), ident: flag(28), singleAntenna: flag(30), sda: bits(me, 31, 2) }
			: null,
		raw: { capabilityClass: bits(me, 9, 16), operationalMode: bits(me, 25, 16) }
	};
}

/** NACp: the 95 % accuracy bound of the position (estimated position uncertainty, EPU). */
export const NAC_P = [
	'unknown',
	'< 10 NM',
	'< 4 NM',
	'< 2 NM',
	'< 1 NM',
	'< 0.5 NM',
	'< 0.3 NM',
	'< 0.1 NM',
	'< 0.05 NM',
	'< 30 m',
	'< 10 m',
	'< 3 m'
];

/** SIL: the probability that the position is outside the containment radius without warning. */
export const SIL = ['unknown', '≤ 1e-3', '≤ 1e-5', '≤ 1e-7'];
