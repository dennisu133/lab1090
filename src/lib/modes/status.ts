/**
 * The ADS-B status messages: what the aircraft says about itself rather than where it is.
 *
 *   TC 28  Aircraft status:          emergency state and squawk, or an ACAS advisory
 *   TC 29  Target state and status:  what the autopilot is set to / flying towards
 *   TC 31  Operational status:       ADS-B version, capabilities, accuracy and integrity
 *
 * Shared by server and browser; no state here.
 */
import { resolutionAdvisory, type ResolutionAdvisory } from './acas';
import { bits } from './frame';
import { squawk } from './squawk';

// ---------------------------------------------------------------------------------------
// TC 28: TC (5) | ST (3) | 48 bits, depending on the subtype
//
//   ST 1: emergency (3) | ID (13) | reserved (32)
//   ST 2: a copy of an active ACAS resolution advisory, as in Comm-B register 3,0 (acas.ts)

export interface AircraftStatus {
	kind: 'aircraft-status';
	/** 0: no information. 1: emergency/priority status. 2: resolution advisory. 3–7: reserved. */
	subtype: number;
	/** Subtype 1 only. */
	emergency: number | null;
	squawk: string | null;
	/** Subtype 2 only: sent while ACAS gives the pilots a resolution advisory, and shortly after. */
	advisory: ResolutionAdvisory | null;
}

export function aircraftStatus(me: Uint8Array): AircraftStatus | null {
	if (bits(me, 1, 5) !== 28) return null;
	const subtype = bits(me, 6, 3);
	const st1 = subtype === 1;
	return {
		kind: 'aircraft-status',
		subtype,
		emergency: st1 ? bits(me, 9, 3) : null,
		squawk: st1 ? squawk(bits(me, 12, 13)) : null,
		advisory: subtype === 2 ? resolutionAdvisory(me) : null
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
// TC 29: two different messages under one type code, told apart by the 2-bit subtype.
//
// Subtype 1 (DO-260B, ADS-B version 2): what the autopilot is set to.
//
//   TC (5) | ST (2) | SIL-S (1) | SRC (1) | SEL ALT (11) | QNH (9) | HDG-S (1) | HDG (9)
//   | NACp (4) | NICbaro (1) | SIL (2) | MODE-S (1) | AP VNAV ALT IMF APP TCAS LNAV (7) | (2)
//
// Subtype 0 (DO-260A, version 1): what the aircraft is flying towards, and how.
//
//   TC (5) | ST (2) | VDS (2) | ALT TYPE (1) | 0 (1) | CAP (2) | VMODE (2) | TARGET ALT (10)
//   | HDS (2) | TARGET HDG (9) | TRK/HDG (1) | HMODE (2) | NACp (4) | NICbaro (1) | SIL (2)
//   | reserved (5) | ACAS (2) | EMERGENCY (3)
//
// Subtype 0's layout is from readsb (we have no copy of DO-260A; pyModeS reads every
// subtype as if it were 1). Version 1 is rare today, so it has seen little real data.

export type TargetState = TargetStateV2 | TargetStateV1 | TargetStateReserved;

export interface TargetStateV2 {
	kind: 'target-state';
	subtype: 1;
	/** The altitude the pilot dialled in on the glareshield (MCP/FCU) or the FMS plans. */
	selectedAltitude: { feet: number; source: 'MCP/FCU' | 'FMS' } | null;
	/**
	 * The altimeter setting in hPa, 0.8 hPa steps: standard (above the transition altitude)
	 * arrives as 1012.8 or 1013.6.
	 */
	qnh: number | null;
	/** Degrees. */
	selectedHeading: number | null;
	nacP: number;
	nicBaro: number;
	sil: number;
	/** SIL is a probability per flight hour (0) or per sample (1). */
	silSupplement: number;
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

/** Acquiring: on the way to the target. Maintaining: there, or capturing it. */
export type TargetMode = 'none' | 'acquiring' | 'maintaining' | 'reserved';

export interface TargetStateV1 {
	kind: 'target-state';
	subtype: 0;
	/** Where the target altitude comes from; null: no target altitude. */
	vertical: {
		source: 'MCP/FCU' | 'holding altitude' | 'FMS/RNAV';
		/** ft; flight level (pressure altitude) or above mean sea level, see `type`. */
		altitude: number;
		type: 'flight level' | 'MSL';
		mode: TargetMode;
		/** What the avionics can report at all: 0 holding altitude only, 1 also MCP/FCU, 2 also FMS/RNAV. */
		capability: number;
	} | null;
	/** Where the target heading or track comes from; null: none. */
	horizontal: {
		source: 'MCP/FCU' | 'holding heading/track' | 'FMS/RNAV';
		/** Degrees, whole degrees. */
		angle: number;
		type: 'heading' | 'track';
		mode: TargetMode;
	} | null;
	nacP: number;
	nicBaro: number;
	sil: number;
	/** ACAS, bits 52–53, as readsb reads them: 1 not operational, 2–3 operational, 0 unknown. */
	acas: { code: number; operational: boolean | null };
	/** Emergency/priority status, as in TC 28 (EMERGENCY_STATES). */
	emergency: number;
}

/** Subtypes 2 and 3: not defined. */
export interface TargetStateReserved {
	kind: 'target-state';
	subtype: 2 | 3;
}

const TARGET_MODES: TargetMode[] = ['none', 'acquiring', 'maintaining', 'reserved'];

export function targetState(me: Uint8Array): TargetState | null {
	if (bits(me, 1, 5) !== 29) return null;
	const subtype = bits(me, 6, 2);
	const flag = (bit: number) => bits(me, bit, 1) === 1;
	if (subtype === 0) return targetStateV1(me);
	if (subtype !== 1) return { kind: 'target-state', subtype: subtype as 2 | 3 };
	const alt = bits(me, 10, 11);
	const qnh = bits(me, 21, 9);
	return {
		kind: 'target-state',
		subtype,
		selectedAltitude:
			alt === 0 ? null : { feet: (alt - 1) * 32, source: flag(9) ? 'FMS' : 'MCP/FCU' },
		// round(): 800 + n × 0.8 isn't exact in floating point.
		qnh: qnh === 0 ? null : Math.round((800 + (qnh - 1) * 0.8) * 10) / 10,
		selectedHeading: flag(30) ? (bits(me, 31, 9) * 360) / 512 : null,
		nacP: bits(me, 40, 4),
		nicBaro: bits(me, 44, 1),
		sil: bits(me, 45, 2),
		silSupplement: bits(me, 8, 1),
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

const TARGET_SOURCES = [null, 'MCP/FCU', 'holding altitude', 'FMS/RNAV'] as const;
const HEADING_SOURCES = [null, 'MCP/FCU', 'holding heading/track', 'FMS/RNAV'] as const;

function targetStateV1(me: Uint8Array): TargetStateV1 {
	const vSource = TARGET_SOURCES[bits(me, 8, 2)];
	const hSource = HEADING_SOURCES[bits(me, 26, 2)];
	const acas = bits(me, 52, 2);
	return {
		kind: 'target-state',
		subtype: 0,
		vertical: vSource && {
			source: vSource,
			altitude: -1000 + 100 * bits(me, 16, 10),
			type: bits(me, 10, 1) ? 'MSL' : 'flight level',
			mode: TARGET_MODES[bits(me, 14, 2)],
			capability: bits(me, 12, 2)
		},
		horizontal: hSource && {
			source: hSource,
			angle: bits(me, 28, 9),
			type: bits(me, 37, 1) ? 'track' : 'heading',
			mode: TARGET_MODES[bits(me, 38, 2)]
		},
		nacP: bits(me, 40, 4),
		nicBaro: bits(me, 44, 1),
		sil: bits(me, 45, 2),
		acas: { code: acas, operational: acas === 0 ? null : acas >= 2 },
		emergency: bits(me, 54, 3)
	};
}

// ---------------------------------------------------------------------------------------
// TC 31: operational status. The layout depends on the subtype (airborne/surface) *and* on
// the ADS-B version the message itself announces in bits 41–43:
//
//   TC (5) | ST (3) | CC (16) | OM (16) | VERSION (3) | NIC-A (1) | NACp (4) | 2 bits
//   | SIL (2) | 1 bit | HRD (1) | SIL-S (1) | (1)
//
//   CC   capability class: airborne 16 bits; surface 12 bits + aircraft length/width (4)
//   OM   operational mode: 2 format bits (00), RA IDENT ATC SAF SDA(2), then 8 bits that only
//        surface messages use (GPS antenna offset, version 2)
//   49–50  airborne: BAQ (version 1), GVA (version 2). Surface: reserved.
//   53     airborne: NICbaro. Surface: TAH, whether surface messages report track or heading.
//
// Version 0 (DO-260) defined only a few capability bits; versions 3–7 are reserved. Their
// other fields are left null.

export interface OperationalStatus {
	kind: 'operational-status';
	subtype: 'airborne' | 'surface' | number;
	/** 0 = DO-260, 1 = DO-260A, 2 = DO-260B. Decides how other messages are read. */
	version: number;
	/** With the type code and NIC-B/NIC-C, picks Rc for TC 7, 8, 11, 13 and 16 ("NIC supplement" in version 1). */
	nicSupplementA: number | null;
	nacP: number | null;
	sil: number | null;
	/** SIL is a probability per flight hour (0) or per sample (1). Version 2. */
	silSupplement: number | null;
	/** Airborne, version 2: geometric vertical accuracy (95 %), 0 unknown or > 150 m, 1 ≤ 150 m, 2 ≤ 45 m, 3 reserved (DO-260B 2.2.3.2.7.2.8). */
	gva: number | null;
	/** Airborne, version 1: barometric altitude quality (unused in practice). */
	baq: number | null;
	/** Airborne: barometric altitude cross-checked against a second source (1) or not (0). */
	nicBaro: number | null;
	/** Headings are relative to true north or magnetic north. null in version 0. */
	hrd: 'true' | 'magnetic' | null;
	/** Surface: what the surface position's direction field holds (TAH). */
	surfaceDirection: 'track' | 'heading' | null;
	/** The capability bits that exist in this version and subtype (null = not in this one). */
	capabilities: {
		/** ACAS/TCAS operational (versions 0/1 send it inverted, as "not ACAS"). */
		tcasOperational: boolean | null;
		/** Has a cockpit display of traffic (CDTI). Versions 0/1. */
		cdti: boolean | null;
		/** Can receive 1090 MHz ADS-B itself ("ADS-B In"). Version 2. */
		es1090In: boolean | null;
		/** Can receive 978 MHz UAT (the US's second ADS-B frequency). Version 2. */
		uatIn: boolean | null;
		/** Airborne: can send air-referenced velocity reports (TC 19 subtype 3/4). */
		arv: boolean | null;
		/** Airborne: can send target state reports (TC 29). */
		ts: boolean | null;
		/** Airborne: can send trajectory change reports: 0 no, 1 one, 2 several. */
		tc: number | null;
		/** Surface: the position is already shifted from the GPS antenna to the reference point. */
		poa: boolean | null;
		/** Surface: transmits with less than 70 W (class B2 low). */
		b2Low: boolean | null;
		/** Surface, version 2: velocity accuracy, as NACv in TC 19. */
		nacV: number | null;
		/** Surface, version 2: NIC supplement C, with NIC-A picks the containment radius of TC 8. */
		nicSupplementC: number | null;
	} | null;
	/** Versions 1/2, if the OM format bits are 00. */
	modes: {
		raActive: boolean;
		ident: boolean;
		/** Receiving ATC services. */
		atc: boolean;
		/** Version 2: transmits from one antenna only. */
		singleAntenna: boolean | null;
		/** Version 2: system design assurance, 0–3: how well the ADS-B equipment is certified. */
		sda: number | null;
	} | null;
	/** Surface, versions 1/2: the length and width of the aircraft (or vehicle). */
	size: Size | null;
	/** Surface, version 2: where the GPS antenna sits on the aircraft. */
	antennaOffset: AntennaOffset | null;
	raw: { capabilityClass: number; operationalMode: number };
}

export interface Size {
	code: number;
	/** Upper bounds in metres; null if unknown. `widthAbove`: wider than `width`. */
	length: number | null;
	width: number | null;
}

/**
 * GPS antenna offset (DO-260B 2.2.3.2.7.2.4.7). Not cross-checked with a second source:
 * readsb only passes the raw 8 bits on.
 */
export interface AntennaOffset {
	code: number;
	/** Metres from the aircraft's centre line, positive = right. null: no data. */
	lateral: number | null;
	/** Metres behind the nose; 'applied': the sensor already corrects for it; null: no data. */
	longitudinal: number | 'applied' | null;
}

/**
 * Length/width codes: the smallest box the aircraft fits in, upper bounds in metres
 * (DO-260B Table 2-74, as in EUROCONTROL ASTERIX CAT021 I021/271). Code 0 means "no data"
 * in version 2, "< 15 × 11.5 m" in version 1.
 */
const SIZES: [number, number][] = [
	[15, 11.5], [15, 23], [25, 28.5], [25, 34], [35, 33], [35, 38], [45, 39.5], [45, 45],
	[55, 45], [55, 52], [65, 59.5], [65, 67], [75, 72.5], [75, 80], [85, 80], [85, 90]
]; // prettier-ignore

export function aircraftSize(code: number, version: number): Size {
	if (code === 0 && version >= 2) return { code, length: null, width: null };
	const [length, width] = SIZES[code];
	return { code, length, width };
}

export function antennaOffset(code: number): AntennaOffset {
	const lateral = code >> 5; // bits 33–35: direction (1 = right) and 2 m steps
	const longitudinal = code & 0b11111; // bits 36–40: 0 no data, 1 applied, else 2 m steps
	return {
		code,
		lateral: lateral === 0 ? null : (lateral & 0b100 ? 1 : -1) * 2 * (lateral & 0b11),
		longitudinal:
			longitudinal === 0 ? null : longitudinal === 1 ? 'applied' : 2 * (longitudinal - 1)
	};
}

export function operationalStatus(me: Uint8Array): OperationalStatus | null {
	if (bits(me, 1, 5) !== 31) return null;
	const st = bits(me, 6, 3);
	const version = bits(me, 41, 3);
	const flag = (bit: number) => bits(me, bit, 1) === 1;
	const airborne = st === 0;
	const surface = st === 1;
	const known = (airborne || surface) && version <= 2;
	const v12 = known && version >= 1;
	const v2 = known && version === 2;
	const ccFormat = bits(me, 9, 2) === 0; // capability class format "00": the bits below apply
	const omFormat = bits(me, 25, 2) === 0;

	let capabilities: OperationalStatus['capabilities'] = null;
	if (ccFormat && airborne && version === 0) {
		capabilities = { ...NO_CAPABILITIES, tcasOperational: !flag(12), cdti: flag(13) };
	} else if (ccFormat && airborne && v12) {
		capabilities = {
			...NO_CAPABILITIES,
			tcasOperational: v2 ? flag(11) : !flag(11),
			cdti: v2 ? null : flag(12),
			es1090In: v2 ? flag(12) : null,
			uatIn: v2 ? flag(19) : null,
			arv: flag(15),
			ts: flag(16),
			tc: bits(me, 17, 2)
		};
	} else if (ccFormat && surface && v12) {
		capabilities = {
			...NO_CAPABILITIES,
			poa: flag(11),
			cdti: v2 ? null : flag(12),
			es1090In: v2 ? flag(12) : null,
			b2Low: flag(15),
			uatIn: v2 ? flag(16) : null,
			nacV: v2 ? bits(me, 17, 3) : null,
			nicSupplementC: v2 ? bits(me, 20, 1) : null
		};
	}

	return {
		kind: 'operational-status',
		subtype: airborne ? 'airborne' : surface ? 'surface' : st,
		version,
		nicSupplementA: v12 ? bits(me, 44, 1) : null,
		nacP: v12 ? bits(me, 45, 4) : null,
		sil: v12 ? bits(me, 51, 2) : null,
		silSupplement: v2 ? bits(me, 55, 1) : null,
		gva: v2 && airborne ? bits(me, 49, 2) : null,
		baq: v12 && !v2 && airborne ? bits(me, 49, 2) : null,
		nicBaro: v12 && airborne ? bits(me, 53, 1) : null,
		hrd: v12 ? (flag(54) ? 'magnetic' : 'true') : null,
		surfaceDirection: v12 && surface ? (flag(53) ? 'heading' : 'track') : null,
		capabilities,
		modes:
			v12 && omFormat
				? {
						raActive: flag(27),
						ident: flag(28),
						atc: flag(29),
						singleAntenna: v2 ? flag(30) : null,
						sda: v2 ? bits(me, 31, 2) : null
					}
				: null,
		size: v12 && surface && ccFormat ? aircraftSize(bits(me, 21, 4), version) : null,
		antennaOffset: v2 && surface && omFormat ? antennaOffset(bits(me, 33, 8)) : null,
		raw: { capabilityClass: bits(me, 9, 16), operationalMode: bits(me, 25, 16) }
	};
}

const NO_CAPABILITIES: NonNullable<OperationalStatus['capabilities']> = {
	tcasOperational: null,
	cdti: null,
	es1090In: null,
	uatIn: null,
	arv: null,
	ts: null,
	tc: null,
	poa: null,
	b2Low: null,
	nacV: null,
	nicSupplementC: null
};

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
