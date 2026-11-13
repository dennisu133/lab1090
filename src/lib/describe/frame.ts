/**
 * What the Content columns show: everything the decoders found in one frame, as a flat
 * list of short, labelled values. Each one has a tooltip that says what it means.
 *
 * Labels are the field names from the specs (FS, SL, RI, …), so they match the literature.
 */
import { bearing, compass, distanceKm } from '#lib/geo.ts';
import { resolutionAdvisory, type ResolutionAdvisory } from '#lib/modes/acas.ts';
import type { Altitude } from '#lib/modes/altitude.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { bits, downlinkFormat, payload, typeCodeName } from '#lib/modes/frame.ts';
import {
	CAPABILITIES,
	CONTROL_FIELDS,
	REPLY_INFO,
	RESERVATION_TYPES,
	downlinkRequestText,
	messageHeader,
	type FlightStatus,
	type Header
} from '#lib/modes/header.ts';
import {
	SURVEILLANCE_STATUS,
	airbornePosition,
	type AirbornePosition,
	type Cpr,
	type SurfacePosition
} from '#lib/modes/position.ts';
import { SPECIAL_SQUAWKS } from '#lib/modes/squawk.ts';
import { esFormat, extendedSquitter, imf, type Squitter } from '#lib/modes/squitter.ts';
import {
	EMERGENCY_STATES,
	NAC_P,
	SIL,
	type AircraftStatus,
	type OperationalStatus,
	type TargetState
} from '#lib/modes/status.ts';
import type { Velocity } from '#lib/modes/velocity.ts';

export interface Field {
	/** Short label before the value, e.g. "SL". */
	label?: string;
	value: string;
	/** Tooltip: what this is, in words. */
	title: string;
	/** main: the headline values. minor: details, dimmed. alert: worth noticing. */
	tone: 'main' | 'minor' | 'alert';
	mono?: boolean;
}

/** A decoded position: from the reference point (local), an even/odd pair (global), or both. */
export interface Located {
	reference: LatLon | null;
	local: LatLon | null;
	global: LatLon | null;
	/** Surface position (TC 5–8): quarter-size CPR zones. */
	surface?: boolean;
}

const TONE_ORDER = { main: 0, alert: 1, minor: 2 };

export function describe(data: Uint8Array, located: Located | null = null): Field[] {
	const fields: Field[] = [];
	const header = messageHeader(data);
	if (header) fields.push(...headerFields(header));

	const df = downlinkFormat(data);
	if (df === 18 || df === 19) fields.push(...nonTransponderFields(data));
	const squitter = extendedSquitter(data);
	if (squitter) fields.push(...squitterFields(squitter));

	if (df === 16) fields.push(...mvFields(payload(data)!));
	if (df === 20 || df === 21) {
		fields.push({
			label: 'MB',
			value: 'Comm-B',
			title:
				"56 bits from one of the transponder's registers, read out by a radar. The message doesn't say which register: /comm-b infers it.",
			tone: 'minor'
		});
	}
	if (located) fields.push(...locationFields(located));
	// Stable sort: headline values first, details last, each group in decoding order.
	return fields.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
}

// --- shared ------------------------------------------------------------------------------

const n = (x: number) => x.toLocaleString();

export function altitudeField(altitude: Altitude, what = 'Barometric altitude'): Field {
	const title = {
		none: `${what}: not available`,
		'25 ft': `${what} (pressure altitude, standard 1013.25 hPa), in 25 ft steps (Q bit = 1)`,
		Gillham: `${what} in the old Mode C Gillham code, 100 ft steps (Q bit = 0)`,
		metric: `${what}: metric (M bit set). Not used in practice, likely a bit error`,
		GNSS: `GNSS height above the WGS84 ellipsoid, sent in metres`
	}[altitude.encoding];
	if (altitude.feet === null) {
		return {
			label: 'alt',
			value: altitude.encoding === 'none' ? 'n/a' : 'invalid',
			title,
			tone: 'minor'
		};
	}
	return { value: `${n(altitude.feet)} ft`, title, tone: 'main' };
}

function squawkField(code: string): Field {
	const special = SPECIAL_SQUAWKS[code];
	return {
		label: 'sqk',
		value: code,
		title: `Squawk (Mode A code) ${code}${special ? `: ${special.meaning}` : ', assigned by ATC'}`,
		tone: special?.emergency ? 'alert' : 'main',
		mono: true
	};
}

function nacPField(nacP: number): Field {
	return {
		label: 'NACp',
		value: String(nacP),
		title: `Navigation accuracy (position): 95 % of the time within ${NAC_P[nacP] ?? '?'}`,
		tone: 'minor'
	};
}

function silField(sil: number, supplement: number | null = null): Field {
	const per = supplement === null ? '' : supplement ? ' per sample' : ' per flight hour';
	return {
		label: 'SIL',
		value: String(sil),
		title: `Source integrity level: probability ${SIL[sil]}${per} that the position is outside the containment radius without an alert`,
		tone: 'minor'
	};
}

const degrees = (x: number) => `${Math.round(x) % 360}°`;

// --- ACAS --------------------------------------------------------------------------------

/** A resolution advisory: Comm-B 3,0, ADS-B TC 28 subtype 2, or a DF16 coordination reply. */
export function advisoryFields(r: ResolutionAdvisory): Field[] {
	if (!r.active && !r.terminated)
		return [{ value: 'no RA', title: 'No resolution advisory right now', tone: 'minor' }];
	const what = r.downward ? 'descend' : 'climb';
	const fields: Field[] = [
		{
			value: r.terminated
				? 'RA ended'
				: `RA: ${r.corrective ? what : `don't ${what === 'climb' ? 'descend' : 'climb'}`}`,
			title:
				'ACAS resolution advisory: the collision avoidance system is telling the pilots how to avoid another aircraft',
			tone: 'alert'
		}
	];
	if (r.threat?.type === 'address')
		fields.push({
			label: 'threat',
			value: r.threat.icao,
			title: 'The other aircraft',
			tone: 'alert',
			mono: true
		});
	return fields;
}

// --- position ----------------------------------------------------------------------------

/** Two decodes of the same message closer than this are the same position (float noise). */
const SAME_KM = 0.05;

function locationFields({ reference, local, global, surface = false }: Located): Field[] {
	const fields: Field[] = [];
	let position: LatLon;
	if (local && global) {
		const off = distanceKm(local, global);
		if (off < SAME_KM) {
			position = local;
			fields.push({
				value: '✓ pair',
				title:
					'Decoded with the reference point, and the even/odd pair (global decoding) gives the same position: confirmed',
				tone: 'minor'
			});
		} else {
			position = global; // a fresh pair beats a reference that's too far away
			fields.push(
				{
					value: 'pair',
					title: 'Decoded from the even/odd pair (global decoding)',
					tone: 'minor'
				},
				{
					value: `reference decode ${n(Math.round(off))} km off`,
					title: `Decoding with the reference point picked the wrong zone: the aircraft is probably more than ~${surface ? 45 : 150} NM from it. Nothing in the message itself reveals this; only the even/odd pair does. Showing the pair's position instead`,
					tone: 'alert'
				}
			);
		}
	} else if (local) {
		position = local;
		fields.push({
			value: 'unconfirmed',
			title:
				"Decoded with the reference point only. No message from this aircraft's other grid within the last 10 s (yet), so it can't be confirmed",
			tone: 'minor'
		});
	} else if (global) {
		position = global;
		fields.push({
			value: 'pair',
			title:
				'Decoded from the even/odd pair (global decoding). Set REFERENCE_POINT to also decode single messages',
			tone: 'minor'
		});
	} else {
		return [];
	}

	const digits = surface ? 5 : 4;
	fields.unshift({
		value: `${position.lat.toFixed(digits)}, ${position.lon.toFixed(digits)}`,
		title: surface
			? 'Latitude, longitude in degrees (WGS84). Surface CPR resolves about 1.25 m; 5 decimals are about 1 m'
			: 'Latitude, longitude in degrees (WGS84). CPR resolves about 5 m; 4 decimals are about 10 m',
		tone: 'main',
		mono: true
	});
	if (reference) {
		fields.splice(1, 0, {
			value: `${n(Math.round(distanceKm(reference, position)))} km ${compass(bearing(reference, position))}`,
			title:
				"Distance and direction from the reference point (only as exact as the reference is: it's rounded)",
			tone: 'main'
		});
	}
	return fields;
}

// --- header ------------------------------------------------------------------------------

function headerFields(h: Header): Field[] {
	switch (h.df) {
		case 0:
		case 16:
			return [
				altitudeField(h.altitude),
				{
					label: 'VS',
					value: h.onGround ? 'ground' : 'airborne',
					title: 'Vertical status',
					tone: 'minor'
				},
				...(h.crossLink === null
					? []
					: [
							{
								label: 'CC',
								value: h.crossLink ? 'yes' : 'no',
								title:
									'Cross-link capability: can answer air-air requests for a register with a long reply (DF16)',
								tone: 'minor' as const
							}
						]),
				{
					label: 'SL',
					value: String(h.sensitivity),
					title: `ACAS sensitivity level ${h.sensitivity}: ${h.sensitivity === 0 ? 'ACAS inoperative' : 'higher = larger protection volume around the aircraft'}`,
					tone: 'minor'
				},
				{
					label: 'RI',
					value: String(h.replyInfo),
					title: `Reply information: ${REPLY_INFO[h.replyInfo] ?? 'not assigned'}`,
					tone: 'minor'
				}
			];
		case 4:
		case 20:
			return [altitudeField(h.altitude), ...statusFields(h)];
		case 5:
		case 21:
			return [squawkField(h.squawk), ...statusFields(h)];
		case 11:
		case 17:
			return [
				{
					label: 'CA',
					value: String(h.capability),
					title: `Capability: ${CAPABILITIES[h.capability] ?? 'reserved'}`,
					tone: 'minor'
				}
			];
		case 18:
			return [
				{
					label: 'CF',
					value: String(h.control),
					title: `Control field: ${CONTROL_FIELDS[h.control]}`,
					tone: 'minor'
				}
			];
		case 19:
			return [
				{
					label: 'AF',
					value: String(h.application),
					title: `Application field ${h.application}: military extended squitter. What the other 104 bits mean is up to the military (whether AF 0 means "laid out like ADS-B" is disputed)`,
					tone: 'minor'
				}
			];
		case 24:
			return [
				{
					label: 'KE',
					value: h.ke ? 'uplink ack' : 'downlink',
					title:
						'Comm-D: one segment of an extended length message (ELM). KE 0: a segment of a downlink message; 1: acknowledges an uplink ELM',
					tone: 'main'
				},
				{
					label: 'ND',
					value: String(h.nd),
					title: 'Segment number (0–15) within the extended length message',
					tone: 'minor'
				},
				{
					label: 'MD',
					value: h.md,
					title:
						'The 80 bits of message data in this segment. Its meaning depends on the application that sent it',
					tone: 'minor',
					mono: true
				}
			];
	}
}

/**
 * DF18/19: where the message comes from, and anything the regular ADS-B decoders can't read:
 * relayed traffic (TIS-B, ADS-R) and formats with their own layout.
 */
function nonTransponderFields(data: Uint8Array): Field[] {
	const format = esFormat(data);
	const df = downlinkFormat(data);
	if (!format) {
		const field = bits(data, 6, 3);
		return [
			{
				label: 'ME',
				value: 'not decoded',
				title:
					df === 19
						? 'Military format, layout not public. Not laid out like ADS-B (DF17) either: its last 24 bits are not the CRC of the rest'
						: field === 3
							? 'Coarse TIS-B airborne position and velocity: a compressed layout of its own, only used in the US (not decoded)'
							: field === 4
								? 'TIS-B/ADS-R management message: information about the ground station (not decoded)'
								: 'Reserved control field: no defined layout',
				tone: 'minor'
			}
		];
	}
	const fields: Field[] = [];
	if (df === 19) {
		fields.push({
			value: 'decoded as DF17',
			title:
				"A military squitter whose last 24 bits are the CRC of the rest, as in ADS-B (DF17): so it's decoded as ADS-B. A message laid out differently would pass this check once in 16.7 million times",
			tone: 'alert'
		});
	}
	if (format.source !== 'ads-b') {
		fields.push({
			value: format.source === 'tis-b' ? 'TIS-B' : 'ADS-R',
			title:
				format.source === 'tis-b'
					? 'Traffic information service: a ground station relays an aircraft its radar sees (often one without ADS-B). Position and speed come from the radar, not the aircraft'
					: 'ADS-B rebroadcast: a ground station repeats what an aircraft sent on the other ADS-B link (978 MHz UAT, US only)',
			tone: 'main'
		});
	}
	const flag = format.address === 'imf' ? imf(payload(data)!) : null;
	if (format.address === 'non-icao' || flag) {
		fields.push({
			label: 'addr',
			value: 'non-ICAO',
			title:
				format.source === 'tis-b'
					? 'The address is not an ICAO address: 12 bits Mode A code + 12 bits track number the ground station assigned'
					: 'The address is not an ICAO aircraft address: anonymous, a ground vehicle or an obstacle',
			tone: 'alert'
		});
	}
	return fields;
}

function statusFields(h: {
	flightStatus: FlightStatus;
	downlinkRequest: number;
	utility: { iis: number; ids: number };
}): Field[] {
	const fs = h.flightStatus;
	const fields: Field[] = [
		{
			label: 'FS',
			value: [
				fs.onGround === null ? null : fs.onGround ? 'ground' : 'airborne',
				fs.alert ? 'alert' : null,
				fs.spi ? 'SPI' : null
			]
				.filter(Boolean)
				.join(', '),
			title: `Flight status ${fs.code}. Alert: the squawk changed in the last 18 s or is an emergency code. SPI: the pilot pressed IDENT`,
			tone: fs.alert || fs.spi ? 'alert' : 'minor'
		}
	];
	// Both are 0 in nearly every reply: only show them when they say something.
	if (h.downlinkRequest) {
		fields.push({
			label: 'DR',
			value: String(h.downlinkRequest),
			title: `Downlink request: ${downlinkRequestText(h.downlinkRequest)}`,
			tone: 'minor'
		});
	}
	if (h.utility.iis || h.utility.ids) {
		fields.push({
			label: 'UM',
			value: `IIS ${h.utility.iis}/${RESERVATION_TYPES[h.utility.ids]}`,
			title: `Utility message: interrogator ${h.utility.iis} has reserved the transponder (${RESERVATION_TYPES[h.utility.ids]})`,
			tone: 'minor'
		});
	}
	return fields;
}

/**
 * DF16: the MV field. VDS 0x30: an ACAS coordination reply, the same resolution advisory
 * as register 3,0. In practice it mostly holds a copy of the position register, asked for
 * air-to-air.
 */
function mvFields(mv: Uint8Array): Field[] {
	if (mv[0] === 0x30) {
		return [
			{
				label: 'MV',
				value: 'ACAS coordination',
				title:
					"Payload of a long air-air reply, VDS 0x30: this aircraft's ACAS resolution advisory, as another aircraft's ACAS asked for it to coordinate (same layout as register 3,0)",
				tone: 'minor'
			},
			...advisoryFields(resolutionAdvisory(mv))
		];
	}
	const position = airbornePosition(mv);
	const title =
		'Payload of a long air-air (ACAS) reply. Its first 5 bits read like an ADS-B type code: a copy of the airborne position register (BDS 0,5), requested by another aircraft';
	if (!position || position.tc === 0) {
		return [
			{
				label: 'MV',
				value: `VDS ${bits(mv, 1, 8).toString(16)}`,
				title: 'Payload of a long air-air (ACAS) reply',
				tone: 'minor'
			}
		];
	}
	return [
		{ label: 'MV', value: 'position register', title, tone: 'minor' },
		...cprFields(position)
	];
}

// --- ADS-B -------------------------------------------------------------------------------

export function squitterFields(s: Squitter): Field[] {
	switch (s.kind) {
		case 'identification':
			return [
				{ value: s.callsign, title: 'Callsign', tone: 'main', mono: true },
				{
					value: s.category.name,
					title: `Emitter category ${s.category.set}${s.category.code}`,
					tone: 'minor'
				}
			];
		case 'airborne-position':
			return positionFields(s);
		case 'velocity':
			return velocityFields(s);
		case 'surface-position':
			return surfaceFields(s);
		case 'aircraft-status':
			return aircraftStatusFields(s);
		case 'target-state':
			return targetStateFields(s);
		case 'operational-status':
			return operationalStatusFields(s);
		case 'test':
			return [
				{
					value: 'test message',
					title: `TC 23, subtype ${s.subtype}: sent while testing ADS-B equipment`,
					tone: 'alert'
				},
				...(s.squawk ? [squawkField(s.squawk)] : [])
			];
		case 'reserved':
			return [
				{
					label: 'TC',
					value: `${s.tc} reserved`,
					title: `${typeCodeName(s.tc)}: no content defined for this type code (or subtype)`,
					tone: 'alert'
				}
			];
	}
}

function aircraftStatusFields(s: AircraftStatus): Field[] {
	if (s.advisory) {
		return [
			{
				label: 'ST 2',
				value: 'ACAS RA',
				title:
					'Aircraft status subtype 2: a copy of the resolution advisory ACAS is giving the pilots, broadcast while it lasts (same layout as register 3,0)',
				tone: 'alert'
			},
			...advisoryFields(s.advisory)
		];
	}
	if (s.squawk === null) {
		return [
			{
				label: 'ST',
				value: String(s.subtype),
				title: s.subtype === 0 ? 'No information' : 'Reserved subtype',
				tone: 'minor'
			}
		];
	}
	return [
		squawkField(s.squawk),
		{
			value: EMERGENCY_STATES[s.emergency!],
			title: 'Emergency / priority status',
			tone: s.emergency ? 'alert' : 'minor'
		}
	];
}

function surfaceFields(p: SurfacePosition): Field[] {
	const m = p.movement;
	const fields: Field[] = [];
	const kt = (x: number) => x.toLocaleString(undefined, { maximumFractionDigits: 2 });
	fields.push({
		value:
			m.speed === null
				? 'speed n/a'
				: m.stopped
					? 'stopped'
					: m.speed.max === null
						? `> ${m.speed.min} kt`
						: `${kt(m.speed.min)}–${kt(m.speed.max)} kt`,
		title: `Ground speed, movement code ${m.code}: a non-linear scale, fine when taxiing (1/8 kt), coarse when fast (5 kt). Codes 2–8 changed in ADS-B version 2; read as version 2`,
		tone: m.speed === null ? 'minor' : 'main'
	});
	fields.push(
		p.track === null
			? { label: 'trk', value: 'n/a', title: 'Ground track not available', tone: 'minor' }
			: {
					value: degrees(p.track),
					title: 'Ground track or heading (the operational status says which, TAH), 2.8° steps',
					tone: 'main'
				},
		...cprFields(p)
	);
	return fields;
}

function positionFields(p: AirbornePosition): Field[] {
	const fields = [
		p.altitudeSource === 'gnss'
			? { ...altitudeField(p.altitude), label: 'GNSS' }
			: altitudeField(p.altitude),
		...cprFields(p)
	];
	if (p.cpr === null) {
		fields.push({
			value: 'no position',
			title:
				'TC 0: the aircraft has no position to report (e.g. its GNSS is not connected or has failed)',
			tone: 'alert'
		});
	}
	if (p.surveillanceStatus) {
		fields.push({
			label: 'SS',
			value: String(p.surveillanceStatus),
			title: `Surveillance status: ${SURVEILLANCE_STATUS[p.surveillanceStatus]}`,
			tone: 'alert'
		});
	}
	if (p.nicB) {
		fields.push({
			label: 'NIC-B',
			value: '1',
			title:
				'Integrity supplement bit; with the type code it refines the containment radius (in relayed TIS-B/ADS-R messages: the IMF bit instead)',
			tone: 'minor'
		});
	}
	return fields;
}

function cprFields(p: { cpr: Cpr | null }): Field[] {
	if (!p.cpr) return [];
	return [
		{
			label: `CPR ${p.cpr.format}`,
			value: `${p.cpr.lat} / ${p.cpr.lon}`,
			title:
				'Compact Position Reporting: latitude / longitude as 17-bit positions inside a grid cell. Aircraft alternate between an even and an odd grid; turning this into coordinates needs both, or a reference point',
			tone: 'minor',
			mono: true
		}
	];
}

function velocityFields(v: Velocity): Field[] {
	const fields: Field[] = [];
	if (v.ground) {
		fields.push(
			{ value: `${Math.round(v.ground.speed)} kt`, title: 'Ground speed', tone: 'main' },
			{
				value: degrees(v.ground.track),
				title: 'Track: direction of movement over the ground, from true north',
				tone: 'main'
			}
		);
	} else if (v.air) {
		fields.push(
			{
				label: v.air.type,
				value: v.air.speed === null ? 'n/a' : `${v.air.speed} kt`,
				title: `${v.air.type === 'IAS' ? 'Indicated' : 'True'} airspeed: speed through the air. Sent instead of ground speed when the aircraft can't measure that (no GNSS velocity)`,
				tone: 'main'
			},
			{
				label: 'hdg',
				value: v.air.heading === null ? 'n/a' : degrees(v.air.heading),
				title: 'Heading: where the nose points (differs from the track by the wind)',
				tone: 'main'
			}
		);
	} else {
		fields.push({ value: 'speed n/a', title: 'Velocity not available', tone: 'minor' });
	}
	if (v.verticalRate !== null) {
		const vr = v.verticalRate;
		fields.push({
			value: vr === 0 ? 'level' : `${vr > 0 ? '↑' : '↓'} ${n(Math.abs(vr))} ft/min`,
			title: `Vertical rate (${v.verticalRateSource === 'baro' ? 'from the barometric altimeter' : 'from GNSS'}), 64 ft/min steps`,
			tone: 'main'
		});
	}
	if (v.gnssMinusBaro !== null) {
		fields.push({
			label: 'GNSS−baro',
			value: `${v.gnssMinusBaro > 0 ? '+' : ''}${n(v.gnssMinusBaro)} ft`,
			title:
				'GNSS height minus barometric altitude. Barometric altitude assumes a standard atmosphere, so the difference shows the actual weather: positive in warm air, negative in cold air',
			tone: 'minor'
		});
	}
	fields.push(nacVField(v.nacV));
	// Versions 0/1 only (reserved since): show them when set.
	if (v.intentChange) {
		fields.push({
			label: 'IC',
			value: '1',
			title:
				'Intent change: the aircraft changed its intent (e.g. selected altitude) in the last 4 s. ADS-B versions 0/1; reserved in version 2. In relayed TIS-B/ADS-R messages: the IMF bit instead',
			tone: 'minor'
		});
	}
	if (v.ifrCapability) {
		fields.push({
			label: 'IFR',
			value: '1',
			title:
				'Equipped for instrument flight rules (class A1 or above). ADS-B versions 0/1; reserved in version 2',
			tone: 'minor'
		});
	}
	return fields;
}

function nacVField(nacV: number): Field {
	return {
		label: 'NACv',
		value: String(nacV),
		title: `Velocity accuracy (95 %): ${['unknown', '< 10 m/s', '< 3 m/s', '< 1 m/s', '< 0.3 m/s'][nacV] ?? 'reserved'}`,
		tone: 'minor'
	};
}

const flags = (pairs: [unknown, string][]) =>
	pairs
		.filter(([on]) => on)
		.map(([, name]) => name)
		.join(' ') || 'none';

function targetStateFields(t: TargetState): Field[] {
	if (t.subtype === 0) return targetStateV1Fields(t);
	if (t.subtype !== 1) {
		return [
			{
				label: 'ST',
				value: `${t.subtype} reserved`,
				title: 'Target state subtype not defined',
				tone: 'alert'
			}
		];
	}
	const fields: Field[] = [];
	if (t.selectedAltitude) {
		fields.push({
			label: 'sel',
			value: `${n(t.selectedAltitude.feet)} ft`,
			title: `Selected altitude, from the ${t.selectedAltitude.source === 'FMS' ? 'flight management system' : 'autopilot control panel (MCP/FCU)'}: where the aircraft is cleared to and will level off. 32 ft steps, so 38,016 means 38,000`,
			tone: 'main'
		});
	}
	if (t.qnh !== null) {
		fields.push({
			label: 'QNH',
			value: `${t.qnh} hPa`,
			title:
				"Altimeter setting. Above the transition altitude everyone uses the standard 1013.25 hPa, which this 0.8 hPa-step field can't hold exactly: it arrives as 1012.8 or 1013.6",
			tone: 'main'
		});
	}
	if (t.selectedHeading !== null) {
		fields.push({
			label: 'sel hdg',
			value: degrees(t.selectedHeading),
			title: 'Selected heading',
			tone: 'main'
		});
	}
	if (t.modes) {
		const m = t.modes;
		fields.push({
			label: 'modes',
			value: flags([
				[m.autopilot, 'AP'],
				[m.lnav, 'LNAV'],
				[m.vnav, 'VNAV'],
				[m.altitudeHold, 'ALT'],
				[m.approach, 'APP']
			]),
			title:
				'Autopilot engaged (AP), lateral navigation (LNAV: follows the route), vertical navigation (VNAV: follows the planned profile), altitude hold (ALT), approach (APP)',
			tone: 'main'
		});
	}
	fields.push(
		{
			label: 'TCAS',
			value: t.tcasOperational ? 'on' : 'off',
			title: 'Collision avoidance system operational',
			tone: t.tcasOperational ? 'minor' : 'alert'
		},
		nacPField(t.nacP),
		silField(t.sil, t.silSupplement),
		nicBaroField(t.nicBaro)
	);
	return fields;
}

const MODE_TEXT = {
	none: 'no mode',
	acquiring: 'acquiring',
	maintaining: 'capturing or maintaining',
	reserved: 'reserved'
};

/** TC 29 subtype 0 (DO-260A): targets rather than settings. */
function targetStateV1Fields(t: Extract<TargetState, { subtype: 0 }>): Field[] {
	const fields: Field[] = [
		{
			value: 'DO-260A',
			title:
				'Target state, ADS-B version 1 layout (subtype 0): the altitude and heading the aircraft is flying towards. Layout as readsb decodes it',
			tone: 'minor'
		}
	];
	const v = t.vertical;
	if (v) {
		fields.push({
			label: 'target',
			value: v.type === 'flight level' ? `FL${n(v.altitude / 100)}` : `${n(v.altitude)} ft`,
			title: `Target altitude, from ${v.source} (${MODE_TEXT[v.mode]}), ${v.type === 'flight level' ? 'a flight level (pressure altitude)' : 'above mean sea level'}. 100 ft steps`,
			tone: 'main'
		});
	}
	const h = t.horizontal;
	if (h) {
		fields.push({
			label: `target ${h.type === 'track' ? 'trk' : 'hdg'}`,
			value: degrees(h.angle),
			title: `Target ${h.type}, from ${h.source} (${MODE_TEXT[h.mode]})`,
			tone: 'main'
		});
	}
	if (t.acas.operational !== null) {
		fields.push({
			label: 'TCAS',
			value: t.acas.operational ? 'on' : 'off',
			title: `Collision avoidance system (code ${t.acas.code})`,
			tone: t.acas.operational ? 'minor' : 'alert'
		});
	}
	if (t.emergency) {
		fields.push({
			value: EMERGENCY_STATES[t.emergency],
			title: 'Emergency / priority status',
			tone: 'alert'
		});
	}
	fields.push(nacPField(t.nacP), silField(t.sil), nicBaroField(t.nicBaro));
	return fields;
}

function nicBaroField(nicBaro: number): Field {
	return {
		label: 'NICbaro',
		value: String(nicBaro),
		title: 'Barometric altitude cross-checked against a second source (1) or not (0)',
		tone: 'minor'
	};
}

const GVA = ['unknown', '> 150 m', '≤ 150 m', '≤ 45 m'];

function operationalStatusFields(s: OperationalStatus): Field[] {
	const fields: Field[] = [
		{
			value: `ADS-B v${s.version}`,
			title: `Version ${s.version}: ${['DO-260', 'DO-260A', 'DO-260B'][s.version] ?? 'reserved, layout unknown'}. Decides how some other fields are read`,
			tone: 'main'
		}
	];
	if (s.subtype !== 'airborne') {
		fields.push({
			label: 'ST',
			value: String(s.subtype),
			title: s.subtype === 'surface' ? 'Surface status (subtype 1)' : 'Reserved subtype',
			tone: s.subtype === 'surface' ? 'main' : 'alert'
		});
	}
	if (s.size) {
		const { length, width } = s.size;
		fields.push({
			label: 'size',
			value: length === null ? 'n/a' : `≤ ${length} × ${width} m`,
			title: `Length/width code ${s.size.code}: the aircraft fits in ${length === null ? '(no data)' : `${length} m long, ${width} m wide`}. Upper bounds, for spacing on the ground`,
			tone: 'main'
		});
	}
	if (s.nacP !== null) fields.push(nacPField(s.nacP));
	if (s.sil !== null) fields.push(silField(s.sil, s.silSupplement));
	if (s.nicSupplementA !== null) {
		fields.push({
			label: s.version === 1 ? 'NIC-S' : 'NIC-A',
			value: String(s.nicSupplementA),
			title: 'NIC supplement (A): picks between the two containment radii of TC 7, 11, 13 and 16',
			tone: 'minor'
		});
	}
	if (s.nicBaro !== null) fields.push(nicBaroField(s.nicBaro));
	if (s.gva !== null) {
		fields.push({
			label: 'GVA',
			value: String(s.gva),
			title: `Geometric vertical accuracy (95 %) of the GNSS height: ${GVA[s.gva]}`,
			tone: 'minor'
		});
	}
	if (s.baq) {
		fields.push({
			label: 'BAQ',
			value: String(s.baq),
			title: 'Barometric altitude quality (version 1; always 0 in practice)',
			tone: 'minor'
		});
	}
	const c = s.capabilities;
	if (c) {
		fields.push({
			label: 'can',
			value: flags([
				[c.tcasOperational, 'TCAS'],
				[c.cdti, 'CDTI'],
				[c.es1090In, '1090 in'],
				[c.uatIn, 'UAT in'],
				[c.arv, 'ARV'],
				[c.ts, 'TS'],
				[c.tc, 'TC'],
				[c.poa, 'POA'],
				[c.b2Low, 'B2 low']
			]),
			title:
				'Capabilities: TCAS operational; cockpit traffic display (CDTI); receives ADS-B itself on 1090 MHz / 978 MHz UAT ("ADS-B In"); sends air-referenced velocity (ARV), target state (TS), trajectory change (TC) reports. Surface: position offset to the reference point already applied (POA); transmits with < 70 W (B2 low)',
			tone: 'minor'
		});
		if (c.nacV !== null) fields.push(nacVField(c.nacV));
		if (c.nicSupplementC) {
			fields.push({
				label: 'NIC-C',
				value: '1',
				title: 'NIC supplement C: with NIC-A, refines the containment radius of TC 7',
				tone: 'minor'
			});
		}
	}
	const offset = s.antennaOffset;
	if (offset && (offset.lateral !== null || offset.longitudinal !== null)) {
		const lateral =
			offset.lateral === null
				? null
				: offset.lateral === 0
					? 'on centre line'
					: `${Math.abs(offset.lateral)} m ${offset.lateral > 0 ? 'right' : 'left'}`;
		const longitudinal =
			offset.longitudinal === null
				? null
				: offset.longitudinal === 'applied'
					? 'offset applied by sensor'
					: `${offset.longitudinal} m behind the nose`;
		fields.push({
			label: 'GPS',
			value: [lateral, longitudinal].filter(Boolean).join(', '),
			title: `GPS antenna offset (code ${offset.code}): where on the aircraft the position is measured, in 2 m steps`,
			tone: 'minor'
		});
	}
	if (s.surfaceDirection) {
		fields.push({
			label: 'TAH',
			value: s.surfaceDirection,
			title: `Surface positions report the aircraft's ${s.surfaceDirection === 'track' ? 'ground track' : 'heading'}`,
			tone: 'minor'
		});
	}
	const m = s.modes;
	if (m) {
		if (m.sda !== null) {
			fields.push({
				label: 'SDA',
				value: String(m.sda),
				title: 'System design assurance 0–3: how strictly the ADS-B equipment is certified',
				tone: 'minor'
			});
		}
		if (m.singleAntenna) {
			fields.push({
				value: 'single antenna',
				title: 'Transmits from one antenna only (airliners have one on top and one below)',
				tone: 'minor'
			});
		}
		if (m.atc) {
			fields.push({
				value: 'ATC services',
				title: 'Receiving ATC services (set by the crew or the avionics)',
				tone: 'minor'
			});
		}
		if (m.raActive) {
			fields.push({
				value: 'TCAS RA',
				title: 'A TCAS resolution advisory is active right now',
				tone: 'alert'
			});
		}
		if (m.ident) {
			fields.push({ value: 'IDENT', title: 'The IDENT switch is active', tone: 'alert' });
		}
	}
	if (s.hrd === 'magnetic') {
		fields.push({
			label: 'HRD',
			value: 'magnetic',
			title: 'Headings are relative to magnetic north',
			tone: 'minor'
		});
	}
	return fields;
}
