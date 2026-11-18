/**
 * Comm-B registers: the 56-bit MB field of DF20/21 replies.
 *
 * A Mode S transponder holds up to 256 registers of 56 bits each, numbered by their BDS code
 * ("Comm-B Data Selector", written as two hex digits: 4,0 is register 0x40). A radar asks
 * for one by number in its interrogation; the reply carries the 56 bits, but *not* the
 * number. Some registers start with their own number (1,0 / 2,0 / 3,0), the rest have to be
 * recognised by their content: see comm-b.ts.
 *
 * Each register here has a `reject` function, which says why 56 given bits *can't* be that
 * register (or null if they can), and a `decode` function. Bit numbers are the ones in the
 * spec tables (ICAO Doc 9871): MB bit 1 is the first bit of the payload.
 *
 * The checks for 1,0 to 6,0, 4,4 and 4,5 are the same as pyModeS's, and tested against it.
 * 5,3 follows ICAO Doc 9871 (and pyModeS 2, which had it), 2,1 Doc 9871 as jet1090 reads
 * it (pyModeS doesn't decode it). 5,1 and 5,2 are not public
 * (pyModeS doesn't decode them); their layout here is inferred from real replies, compared
 * with the same aircraft's ADS-B position and altitude.
 *
 * Shared by server and browser; no state here.
 */
import { resolutionAdvisory, type ResolutionAdvisory as Advisory } from './acas';
import { bits } from './frame';
import { callsign, character } from './identification';
import { squitter, type Squitter } from './squitter';

export type Register =
	| DataLinkCapability
	| GicbCapability
	| AircraftIdentification
	| Registration
	| ResolutionAdvisory
	| VerticalIntention
	| TrackAndTurn
	| PositionCoarse
	| PositionFine
	| HeadingAndSpeed
	| MeteoRoutine
	| MeteoHazard
	| AirReferencedState
	| ExtendedSquitter;

export interface RegisterSpec {
	bds: string;
	name: string;
	/** Why `mb` can't be this register; null if it can. */
	reject(mb: Uint8Array): string | null;
	/** Only meaningful if `reject` returned null. */
	decode(mb: Uint8Array): Register;
}

// --- helpers -------------------------------------------------------------------------------

const flag = (mb: Uint8Array, bit: number) => bits(mb, bit, 1) === 1;

/** Two's complement: the top bit of the field counts negative. */
function signed(raw: number, width: number): number {
	return raw >= 2 ** (width - 1) ? raw - 2 ** width : raw;
}

/** Angles come as signed values; turn −90° into 270°. */
const normalise = (degrees: number) => ((degrees % 360) + 360) % 360;

/**
 * Most registers put a status bit in front of each value: 1 = the value is valid. A status
 * of 0 with value bits set can't happen in a real register, so it rules the register out.
 */
function wrongStatus(mb: Uint8Array, status: number, count: number, what: string): string | null {
	return !flag(mb, status) && bits(mb, status + 1, count) !== 0
		? `${what}: status bit ${status} says "no data", but its ${count} value bits aren't zero`
		: null;
}

/** The value after a status bit, or null if the status bit is 0. */
function gated(mb: Uint8Array, status: number, count: number): number | null {
	return flag(mb, status) ? bits(mb, status + 1, count) : null;
}

/** Same, for a field that starts with a sign bit (two's complement over `count` bits). */
function gatedSigned(mb: Uint8Array, status: number, count: number): number | null {
	const raw = gated(mb, status, count);
	return raw === null ? null : signed(raw, count);
}

function firstOf(...reasons: (string | null)[]): string | null {
	return reasons.find((r) => r !== null) ?? null;
}

const hex2 = (n: number) => `0x${n.toString(16).padStart(2, '0')}`;

function formatId(mb: Uint8Array, id: number): string | null {
	const first = bits(mb, 1, 8);
	return first === id ? null : `starts with ${hex2(first)}, not its number ${hex2(id)}`;
}

// --- 1,0 Data link capability report -----------------------------------------------------

export interface DataLinkCapability {
	bds: '1,0';
	/** Bit 9: the capability report continues in register 1,1. */
	continuation: boolean;
	/** Bit 15: can overlay the register number on the parity ("data parity"). */
	overlay: boolean;
	/** Bit 16. */
	acasOperational: boolean;
	/** Bits 17–23: which version of the Mode S data link protocol. */
	subnetworkVersion: number;
	/** Bit 24: level 5 transponder (enhanced protocol, several radars at once). */
	level5: boolean;
	/** Bit 25. */
	specificServices: boolean;
	/** Bits 26–28 and 29–32: extended length messages, segments per burst. */
	uplinkElm: number;
	downlinkElm: number;
	/** Bit 33: can report its callsign (register 2,0). */
	identification: boolean;
	/** Bit 34: sends extended squitter (ADS-B). */
	squitter: boolean;
	/** Bit 35: understands surveillance identifier codes (SI). */
	surveillanceIdentifier: boolean;
	/** Bit 36: toggles whenever register 1,7 changes. */
	gicbChanged: boolean;
	/** Bit 37. */
	acasHybrid: boolean;
	/** Bit 38: ACAS can issue resolution advisories (not just traffic advisories). */
	acasRa: boolean;
	/** Bits 39–40. */
	acasVersion: number;
	/** Bits 41–56. */
	dteStatus: number;
}

const BDS_1_0: RegisterSpec = {
	bds: '1,0',
	name: 'Data link capability report',
	reject(mb) {
		const subnet = bits(mb, 17, 7);
		const overlay = flag(mb, 15);
		return firstOf(
			formatId(mb, 0x10),
			bits(mb, 10, 5) !== 0 ? 'reserved bits 10–14 must be zero' : null,
			// Not in the spec but true in practice (and pyModeS checks it): overlay came with
			// subnetwork version 5.
			overlay && subnet < 5 ? `overlay capability, but subnetwork version ${subnet} < 5` : null,
			!overlay && subnet > 4 ? `subnetwork version ${subnet} but no overlay capability` : null
		);
	},
	decode: (mb) => ({
		bds: '1,0',
		continuation: flag(mb, 9),
		overlay: flag(mb, 15),
		acasOperational: flag(mb, 16),
		subnetworkVersion: bits(mb, 17, 7),
		level5: flag(mb, 24),
		specificServices: flag(mb, 25),
		uplinkElm: bits(mb, 26, 3),
		downlinkElm: bits(mb, 29, 4),
		identification: flag(mb, 33),
		squitter: flag(mb, 34),
		surveillanceIdentifier: flag(mb, 35),
		gicbChanged: flag(mb, 36),
		acasHybrid: flag(mb, 37),
		acasRa: flag(mb, 38),
		acasVersion: bits(mb, 39, 2),
		dteStatus: bits(mb, 41, 16)
	})
};

// --- 1,7 Common usage GICB capability report ---------------------------------------------

export interface GicbCapability {
	bds: '1,7';
	/** The registers the transponder says it can deliver, e.g. ["0,5", …, "6,0"]. */
	supported: string[];
}

/** Bit n of register 1,7 stands for register GICB_MAP[n − 1]. */
export const GICB_MAP = [
	'0,5', '0,6', '0,7', '0,8', '0,9', '0,A', '2,0', '2,1', '4,0', '4,1', '4,2', '4,3',
	'4,4', '4,5', '4,8', '5,0', '5,1', '5,2', '5,3', '5,4', '5,5', '5,6', '5,F', '6,0'
]; // prettier-ignore

const BDS_1_7: RegisterSpec = {
	bds: '1,7',
	name: 'Common usage GICB capability report',
	reject(mb) {
		return firstOf(
			// Every transponder that has 1,7 can report its callsign.
			!flag(mb, 7) ? 'bit 7 (2,0 supported) is 0, but every aircraft supports 2,0' : null,
			bits(mb, 25, 32) !== 0 ? 'bits 25–56 must be zero' : null
		);
	},
	decode: (mb) => ({ bds: '1,7', supported: GICB_MAP.filter((_, i) => flag(mb, i + 1)) })
};

// --- 2,0 Aircraft identification ---------------------------------------------------------

export interface AircraftIdentification {
	bds: '2,0';
	callsign: string;
}

const BDS_2_0: RegisterSpec = {
	bds: '2,0',
	name: 'Aircraft identification',
	reject(mb) {
		return firstOf(
			formatId(mb, 0x20),
			callsign(mb.subarray(1, 7)).includes('#')
				? 'a character is not a letter, digit or space'
				: null
		);
	},
	decode: (mb) => ({ bds: '2,0', callsign: callsign(mb.subarray(1, 7)) })
};

// --- 2,1 Aircraft and airline registration markings -------------------------------------
//
// ICAO Doc 9871 Table A-2-33, as jet1090 reads it (crates/rs1090/src/decode/bds/bds21.rs,
// which cites the table; the table itself isn't public):
//
//   bit 1        status: 1 = registration available
//   bits 2–43    the registration, 7 characters of 6 bits (2,0's alphabet), left-aligned
//   bit 44       status: 1 = airline mark available
//   bits 45–56   "ICAO airline registration marking", 2 characters
//
// The alphabet has no dash, so the dash is left out ("DAIZA" for D-AIZA) or its place is
// filled: with a space (the alphabet's), or, as jet1090 found in real replies, with code 0
// or 45. All three are read as a gap here.
//
// Its purpose (Doc 9871): to identify the aircraft without keeping a database of addresses.
// Optional, and hardly ever asked for: no radar around this receiver did, in the capture or
// in 15 live minutes, although 5 of 11 transponders in the capture offer it (1,7). Seven
// characters from the alphabet fit by chance now and then, so it's a last resort (RARE),
// and it only counts if the registration starts with the nationality mark of the State the
// address belongs to (nationality.ts; the check is in comm-b.ts).

export interface Registration {
	bds: '2,1';
	/** Without the dash, as sent: "DAIZA". nationality.ts can put it back (D-AIZA). */
	registration: string;
	/** The two airline characters; null if their status bit says "not available". */
	airline: string | null;
}

/** A 2,1 character: '' for a gap (space, 0 or 45), '#' if not in the alphabet. */
function registrationCharacter(mb: Uint8Array, bit: number): string {
	const code = bits(mb, bit, 6);
	return code === 0 || code === 32 || code === 45 ? ' ' : character(code);
}

const registrationText = (mb: Uint8Array) =>
	Array.from({ length: 7 }, (_, i) => registrationCharacter(mb, 2 + 6 * i)).join('');

const BDS_2_1: RegisterSpec = {
	bds: '2,1',
	name: 'Aircraft and airline registration markings',
	reject(mb) {
		const text = registrationText(mb).trimEnd(); // trailing gaps are padding
		const airline = bits(mb, 45, 12);
		return firstOf(
			!flag(mb, 1) ? 'status bit 1 says "no registration"' : null,
			text.includes('#') ? 'a character is not a letter, digit or space' : null,
			!/^[A-Z0-9]+( [A-Z0-9]+)?$/.test(text)
				? 'not a registration: it starts with a gap, or has more than one'
				: null,
			wrongStatus(mb, 44, 12, 'airline mark'),
			flag(mb, 44) && !/^[A-Z0-9]{2}$/.test(character(airline >> 6) + character(airline & 63))
				? 'an airline character is not a letter or digit'
				: null
		);
	},
	decode(mb) {
		const airline = bits(mb, 45, 12);
		return {
			bds: '2,1',
			registration: registrationText(mb).replaceAll(' ', ''),
			airline: flag(mb, 44) ? character(airline >> 6) + character(airline & 63) : null
		};
	}
};

// --- 3,0 ACAS active resolution advisory -------------------------------------------------

export interface ResolutionAdvisory extends Advisory {
	bds: '3,0';
}

const BDS_3_0: RegisterSpec = {
	bds: '3,0',
	name: 'ACAS active resolution advisory',
	reject(mb) {
		return firstOf(
			formatId(mb, 0x30),
			bits(mb, 16, 7) >= 48 ? 'ARA bits 16–22 (reserved for ACAS III) out of range' : null,
			bits(mb, 29, 2) === 3 ? 'threat type 3 is reserved' : null
		);
	},
	decode: (mb) => ({ bds: '3,0', ...resolutionAdvisory(mb) })
};

// --- 4,0 Selected vertical intention -----------------------------------------------------

export interface VerticalIntention {
	bds: '4,0';
	/** What the pilots dialled in on the autopilot panel (MCP/FCU), ft. */
	mcpAltitude: number | null;
	/** What the flight management computer plans, ft. */
	fmsAltitude: number | null;
	/** Altimeter setting, hPa. */
	baroSetting: number | null;
	modes: { vnav: boolean; altitudeHold: boolean; approach: boolean } | null;
	/** Which of the above the aircraft is actually flying towards. */
	targetSource: 'unknown' | 'aircraft altitude' | 'MCP/FCU' | 'FMS' | null;
}

const TARGET_SOURCES = ['unknown', 'aircraft altitude', 'MCP/FCU', 'FMS'] as const;

const BDS_4_0: RegisterSpec = {
	bds: '4,0',
	name: 'Selected vertical intention',
	reject(mb) {
		return firstOf(
			wrongStatus(mb, 1, 12, 'MCP/FCU altitude'),
			wrongStatus(mb, 14, 12, 'FMS altitude'),
			wrongStatus(mb, 27, 12, 'pressure setting'),
			bits(mb, 40, 8) !== 0 ? 'reserved bits 40–47 must be zero' : null,
			wrongStatus(mb, 48, 3, 'autopilot modes'),
			bits(mb, 52, 2) !== 0 ? 'reserved bits 52–53 must be zero' : null,
			wrongStatus(mb, 54, 2, 'target altitude source')
		);
	},
	decode(mb) {
		const mcp = gated(mb, 1, 12);
		const fms = gated(mb, 14, 12);
		const baro = gated(mb, 27, 12);
		const source = gated(mb, 54, 2);
		return {
			bds: '4,0',
			mcpAltitude: mcp === null ? null : mcp * 16,
			fmsAltitude: fms === null ? null : fms * 16,
			baroSetting: baro === null ? null : Math.round(baro + 8000) / 10, // 800 + n × 0.1
			modes: flag(mb, 48)
				? { vnav: flag(mb, 49), altitudeHold: flag(mb, 50), approach: flag(mb, 51) }
				: null,
			targetSource: source === null ? null : TARGET_SOURCES[source]
		};
	}
};

// --- 5,0 Track and turn report -----------------------------------------------------------

export interface TrackAndTurn {
	bds: '5,0';
	/** Bank angle, degrees, positive = right wing down. */
	roll: number | null;
	/** True track over the ground, 0–360°. */
	track: number | null;
	/** kt */
	groundSpeed: number | null;
	/** Degrees per second, positive = turning right. */
	trackRate: number | null;
	/** True airspeed, kt. */
	tas: number | null;
}

const BDS_5_0: RegisterSpec = {
	bds: '5,0',
	name: 'Track and turn report',
	reject(mb) {
		const r = BDS_5_0.decode(mb) as TrackAndTurn;
		return firstOf(
			wrongStatus(mb, 1, 10, 'roll'),
			wrongStatus(mb, 12, 11, 'track'),
			wrongStatus(mb, 24, 10, 'ground speed'),
			wrongStatus(mb, 35, 10, 'track rate'),
			wrongStatus(mb, 46, 10, 'true airspeed'),
			// An airliner hardly ever banks more than 30°; pyModeS draws the line at 35°.
			r.roll !== null && Math.abs(r.roll) > 35
				? `roll ${r.roll.toFixed(1)}° is more than 35°`
				: null,
			r.groundSpeed !== null && r.groundSpeed > 600
				? `ground speed ${r.groundSpeed} kt > 600`
				: null,
			r.tas !== null && r.tas > 600 ? `true airspeed ${r.tas} kt > 600` : null,
			r.tas !== null && r.groundSpeed !== null && Math.abs(r.tas - r.groundSpeed) > 200
				? `true airspeed and ground speed ${Math.abs(r.tas - r.groundSpeed)} kt apart (wind > 200 kt)`
				: null
		);
	},
	decode(mb) {
		const roll = gatedSigned(mb, 1, 10);
		const track = gatedSigned(mb, 12, 11);
		const gs = gated(mb, 24, 10);
		const rate = gatedSigned(mb, 35, 10);
		const tas = gated(mb, 46, 10);
		return {
			bds: '5,0',
			roll: roll === null ? null : (roll * 45) / 256,
			track: track === null ? null : normalise((track * 90) / 512),
			groundSpeed: gs === null ? null : gs * 2,
			trackRate: rate === null ? null : (rate * 8) / 256,
			tas: tas === null ? null : tas * 2
		};
	}
};

// --- 6,0 Heading and speed report --------------------------------------------------------

export interface HeadingAndSpeed {
	bds: '6,0';
	/** Where the nose points, relative to magnetic north, 0–360°. */
	heading: number | null;
	/** Indicated airspeed, kt. */
	ias: number | null;
	mach: number | null;
	/** From the air pressure, ft/min. */
	baroRate: number | null;
	/** From the inertial reference system (accelerometers), ft/min. */
	inertialRate: number | null;
}

const BDS_6_0: RegisterSpec = {
	bds: '6,0',
	name: 'Heading and speed report',
	reject(mb) {
		const r = BDS_6_0.decode(mb) as HeadingAndSpeed;
		const tooSteep = (rate: number | null) => rate !== null && Math.abs(rate) > 6000;
		return firstOf(
			wrongStatus(mb, 1, 11, 'heading'),
			wrongStatus(mb, 13, 10, 'indicated airspeed'),
			wrongStatus(mb, 24, 10, 'Mach'),
			wrongStatus(mb, 35, 10, 'barometric vertical rate'),
			wrongStatus(mb, 46, 10, 'inertial vertical rate'),
			r.ias !== null && r.ias > 500 ? `indicated airspeed ${r.ias} kt > 500` : null,
			r.mach !== null && r.mach > 1 ? `Mach ${r.mach.toFixed(3)} > 1` : null,
			tooSteep(r.baroRate) ? `vertical rate ${r.baroRate} ft/min beyond ±6,000` : null,
			tooSteep(r.inertialRate) ? `vertical rate ${r.inertialRate} ft/min beyond ±6,000` : null
		);
	},
	decode(mb) {
		const heading = gatedSigned(mb, 1, 11);
		const mach = gated(mb, 24, 10);
		const baro = gatedSigned(mb, 35, 10);
		const inertial = gatedSigned(mb, 46, 10);
		return {
			bds: '6,0',
			heading: heading === null ? null : normalise((heading * 90) / 512),
			ias: gated(mb, 13, 10),
			mach: mach === null ? null : (mach * 2.048) / 512,
			baroRate: baro === null ? null : baro * 32,
			inertialRate: inertial === null ? null : inertial * 32
		};
	}
};

// --- 4,4 Meteorological routine air report (MRAR) --------------------------------------

/**
 * What the aircraft's sensors measure of the air around it. Optional: only some aircraft
 * fill it, and only some radars ask for it (the data goes to weather services).
 */
export interface MeteoRoutine {
	bds: '4,4';
	/** Bits 1–4, FOM/source: where the position behind the wind comes from (METEO_SOURCES). */
	source: number;
	/** Bits 5–23. Direction the wind blows *from*, true north, 180/256° steps; speed in kt. */
	wind: { speed: number; direction: number } | null;
	/** Bits 24–34, static air temperature, °C in 0.25° steps. No status bit: always present. */
	temperature: number;
	/** Bits 35–46, average static pressure, hPa. */
	pressure: number | null;
	/** Bits 47–49, 0 nil … 3 severe (HAZARD_LEVELS). */
	turbulence: number | null;
	/** Bits 50–56, relative humidity, %, in 100/64 steps. */
	humidity: number | null;
}

export const METEO_SOURCES = ['invalid', 'INS', 'GNSS', 'DME/DME', 'VOR/DME'];

/** Turbulence, wind shear, … in 4,4 and 4,5. */
export const HAZARD_LEVELS = ['nil', 'light', 'moderate', 'severe'];

const BDS_4_4: RegisterSpec = {
	bds: '4,4',
	name: 'Meteorological routine air report',
	reject(mb) {
		const r = BDS_4_4.decode(mb) as MeteoRoutine;
		return firstOf(
			r.source > 4 ? `FOM/source ${r.source} is reserved (0–4 are defined)` : null,
			// Not required by the spec, but a report without wind says next to nothing (pyModeS).
			!flag(mb, 5) ? 'status bit 5 says "no wind"' : null,
			wrongStatus(mb, 35, 11, 'static pressure'),
			wrongStatus(mb, 47, 2, 'turbulence'),
			wrongStatus(mb, 50, 6, 'humidity'),
			r.wind && r.wind.speed > 250 ? `wind ${r.wind.speed} kt > 250` : null,
			r.temperature < -80 || r.temperature > 60
				? `temperature ${r.temperature} °C beyond −80…+60`
				: null,
			bits(mb, 6, 9) === 0 && bits(mb, 15, 9) === 0 && bits(mb, 25, 10) === 0
				? 'wind and temperature are all zero'
				: null
		);
	},
	decode(mb) {
		const wind = flag(mb, 5);
		const pressure = gated(mb, 35, 11);
		const turbulence = gated(mb, 47, 2);
		const humidity = gated(mb, 50, 6);
		return {
			bds: '4,4',
			source: bits(mb, 1, 4),
			wind: wind ? { speed: bits(mb, 6, 9), direction: (bits(mb, 15, 9) * 180) / 256 } : null,
			temperature: signed(bits(mb, 24, 11), 11) * 0.25,
			pressure,
			turbulence,
			humidity: humidity === null ? null : (humidity * 100) / 64
		};
	}
};

// --- 4,5 Meteorological hazard report (MHR) ---------------------------------------------

export interface MeteoHazard {
	bds: '4,5';
	/** Each 0 nil … 3 severe (HAZARD_LEVELS), null if not reported. */
	turbulence: number | null;
	windShear: number | null;
	microburst: number | null;
	icing: number | null;
	wakeVortex: number | null;
	/** Bits 16–26, static air temperature, °C in 0.25° steps. */
	temperature: number | null;
	/** Bits 27–38, average static pressure, hPa. */
	pressure: number | null;
	/** Bits 39–51, radio height (above the ground, from the radar altimeter), ft in 16 ft steps. */
	radioHeight: number | null;
}

const BDS_4_5: RegisterSpec = {
	bds: '4,5',
	name: 'Meteorological hazard report',
	reject(mb) {
		const r = BDS_4_5.decode(mb) as MeteoHazard;
		return firstOf(
			// 1,7's pattern (32 zero bits at the end) also passes 4,5's checks; it's more specific.
			BDS_1_7.reject(mb) === null ? "fits 1,7's pattern, which is more specific" : null,
			bits(mb, 52, 5) !== 0 ? 'reserved bits 52–56 must be zero' : null,
			wrongStatus(mb, 1, 2, 'turbulence'),
			wrongStatus(mb, 4, 2, 'wind shear'),
			wrongStatus(mb, 7, 2, 'microburst'),
			wrongStatus(mb, 10, 2, 'icing'),
			wrongStatus(mb, 13, 2, 'wake vortex'),
			wrongStatus(mb, 16, 10, 'temperature'),
			wrongStatus(mb, 27, 11, 'static pressure'),
			wrongStatus(mb, 39, 12, 'radio height'),
			r.temperature !== null && (r.temperature < -80 || r.temperature > 60)
				? `temperature ${r.temperature} °C beyond −80…+60`
				: null
		);
	},
	decode(mb) {
		const temperature = gatedSigned(mb, 16, 10);
		const radioHeight = gated(mb, 39, 12);
		return {
			bds: '4,5',
			turbulence: gated(mb, 1, 2),
			windShear: gated(mb, 4, 2),
			microburst: gated(mb, 7, 2),
			icing: gated(mb, 10, 2),
			wakeVortex: gated(mb, 13, 2),
			temperature: temperature === null ? null : temperature * 0.25,
			pressure: gated(mb, 27, 11),
			radioHeight: radioHeight === null ? null : radioHeight * 16
		};
	}
};

// --- 5,3 Air-referenced state vector -----------------------------------------------------

/** The aircraft's movement through the air (not over the ground), from the air data computer. */
export interface AirReferencedState {
	bds: '5,3';
	/** Bits 1–12: magnetic heading, 0–360°, 90/512° steps. */
	heading: number | null;
	/** Bits 13–23: indicated airspeed, kt. */
	ias: number | null;
	/** Bits 24–33: 0.008 steps. */
	mach: number | null;
	/** Bits 34–46: true airspeed, kt, 0.5 kt steps. */
	tas: number | null;
	/** Bits 47–56: altitude rate, ft/min, 64 ft/min steps, positive = climbing. */
	verticalRate: number | null;
}

const BDS_5_3: RegisterSpec = {
	bds: '5,3',
	name: 'Air-referenced state vector',
	reject(mb) {
		const r = BDS_5_3.decode(mb) as AirReferencedState;
		return firstOf(
			wrongStatus(mb, 1, 11, 'heading'),
			wrongStatus(mb, 13, 10, 'indicated airspeed'),
			wrongStatus(mb, 24, 9, 'Mach'),
			wrongStatus(mb, 34, 12, 'true airspeed'),
			wrongStatus(mb, 47, 9, 'vertical rate'),
			// The same limits as for 5,0 and 6,0.
			r.ias !== null && r.ias > 500 ? `indicated airspeed ${r.ias} kt > 500` : null,
			r.mach !== null && r.mach > 1 ? `Mach ${r.mach.toFixed(3)} > 1` : null,
			r.tas !== null && r.tas > 600 ? `true airspeed ${r.tas} kt > 600` : null,
			r.verticalRate !== null && Math.abs(r.verticalRate) > 6000
				? `vertical rate ${r.verticalRate} ft/min beyond ±6,000`
				: null
		);
	},
	decode(mb) {
		const heading = gatedSigned(mb, 1, 11);
		const mach = gated(mb, 24, 9);
		const tas = gated(mb, 34, 12);
		const rate = gatedSigned(mb, 47, 9);
		return {
			bds: '5,3',
			heading: heading === null ? null : normalise((heading * 90) / 512),
			ias: gated(mb, 13, 10),
			mach: mach === null ? null : mach * 0.008,
			tas: tas === null ? null : tas / 2,
			verticalRate: rate === null ? null : rate * 64
		};
	}
};

// --- 5,1 / 5,2 Position report coarse / fine (layout inferred, see the top) --------------

export interface PositionCoarse {
	bds: '5,1';
	/** Degrees, truncated to 360/2^20 (about 38 m of latitude). */
	lat: number;
	lon: number;
	/** ft, 8 ft steps. Pressure altitude, like ADS-B's. */
	altitude: number;
}

export interface PositionFine {
	bds: '5,2';
	/** Bits 2–5. Seems to say where the position comes from; meaning unknown. */
	source: number;
	/**
	 * Latitude and longitude modulo 360/256 = 1.40625°, to 360/2^26 (0.6 m): the digits
	 * that come after 5,1's. Add the right multiple of 1.40625° (see `combineFine`).
	 */
	latFine: number;
	lonFine: number;
	/** ft, 8 ft steps. Baro altitude for some aircraft, GNSS height for others. */
	altitude: number;
}

/** The size of the window that 5,2's fine latitude and longitude repeat in. */
export const FINE_SPAN = 360 / 256;

const ALTITUDE_RANGE = [-1000, 60_000];

function altitudeReason(feet: number): string | null {
	return feet < ALTITUDE_RANGE[0] || feet > ALTITUDE_RANGE[1]
		? `altitude ${feet.toLocaleString('en')} ft is out of range`
		: null;
}

const BDS_5_1: RegisterSpec = {
	bds: '5,1',
	name: 'Position report coarse',
	reject(mb) {
		const r = BDS_5_1.decode(mb) as PositionCoarse;
		return firstOf(
			!flag(mb, 1) ? 'status bit 1 says "no position"' : null,
			Math.abs(r.lat) > 90 ? `latitude ${r.lat.toFixed(1)}° is beyond ±90°` : null,
			altitudeReason(r.altitude)
		);
	},
	decode: (mb) => ({
		bds: '5,1',
		lat: (signed(bits(mb, 2, 20), 20) * 360) / 2 ** 20,
		lon: (signed(bits(mb, 22, 20), 20) * 360) / 2 ** 20,
		altitude: signed(bits(mb, 42, 15), 15) * 8
	})
};

const BDS_5_2: RegisterSpec = {
	bds: '5,2',
	name: 'Position report fine',
	reject(mb) {
		const r = BDS_5_2.decode(mb) as PositionFine;
		return firstOf(
			!flag(mb, 1) ? 'status bit 1 says "no position"' : null,
			altitudeReason(r.altitude)
		);
	},
	decode: (mb) => ({
		bds: '5,2',
		source: bits(mb, 2, 4),
		latFine: (bits(mb, 6, 18) * FINE_SPAN) / 2 ** 18,
		lonFine: (bits(mb, 24, 18) * FINE_SPAN) / 2 ** 18,
		altitude: signed(bits(mb, 42, 15), 15) * 8
	})
};

/**
 * Put 5,2's fine part into the 1.40625° window nearest to a coarse position (5,1, or the
 * aircraft's ADS-B position): the same trick as local CPR decoding, with a smaller zone.
 */
export function combineFine(fine: number, near: number): number {
	return FINE_SPAN * Math.round((near - fine) / FINE_SPAN) + fine;
}

// --- ADS-B registers, read via Comm-B ----------------------------------------------------

/**
 * The ADS-B messages are registers too: 0,5 airborne position, 0,6 surface position, 0,8
 * identification, 0,9 velocity, 6,1 aircraft status, 6,2 target state, 6,5 operational
 * status. A radar can read them like any other (and some do, as a cheap position check).
 * The type code inside says which one it is, so the decoding is ADS-B's (squitter.ts).
 */
export interface ExtendedSquitter {
	bds: '0,5' | '0,6' | '0,8' | '0,9' | '6,1' | '6,2' | '6,5';
	squitter: Squitter;
}

function adsbRegister(
	bds: ExtendedSquitter['bds'],
	name: string,
	kinds: Squitter['kind'][]
): RegisterSpec {
	return {
		bds,
		name,
		reject(mb) {
			const s = squitter(mb);
			if (!kinds.includes(s.kind)) return `type code ${bits(mb, 1, 5)} doesn't fit`;
			if (s.kind === 'identification' && s.callsign.includes('#'))
				return 'a character is not a letter, digit or space';
			return null;
		},
		decode: (mb) => ({ bds, squitter: squitter(mb) })
	};
}

/** Every register we can decode, in the order they're tried. */
export const REGISTERS: RegisterSpec[] = [
	BDS_1_0,
	BDS_1_7,
	BDS_2_0,
	BDS_3_0,
	BDS_4_0,
	BDS_5_0,
	BDS_6_0,
	BDS_5_1,
	BDS_5_2,
	adsbRegister('0,5', 'Extended squitter airborne position', ['airborne-position']),
	adsbRegister('0,6', 'Extended squitter surface position', ['surface-position']),
	adsbRegister('0,8', 'Extended squitter identification', ['identification']),
	adsbRegister('0,9', 'Extended squitter airborne velocity', ['velocity']),
	adsbRegister('6,1', 'Extended squitter aircraft status', ['aircraft-status']),
	adsbRegister('6,2', 'Target state and status', ['target-state']),
	adsbRegister('6,5', 'Aircraft operational status', ['operational-status']),
	// Rarely interrogated: only tried when none of the above fits (see comm-b.ts).
	BDS_4_4,
	BDS_4_5,
	BDS_5_3,
	BDS_2_1
];

/**
 * Registers hardly any radar asks for, with enough structure to fit by chance now and then.
 * inferRegister() only considers them when none of the common registers fits.
 */
export const RARE = new Set(['4,4', '4,5', '5,3', '2,1']);

export const REGISTER_NAMES: Record<string, string> = Object.fromEntries(
	REGISTERS.map((r) => [r.bds, r.name])
);
