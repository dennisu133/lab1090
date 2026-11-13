/**
 * What /raw shows in the Content column: everything the decoders found in one frame, as a
 * flat list of short, labelled values. Each one has a tooltip that says what it means.
 *
 * Labels are the field names from the specs (FS, SL, RI, …), so they match the literature.
 */
import type { Altitude } from '#lib/modes/altitude.ts';
import { bits, downlinkFormat, payload } from '#lib/modes/frame.ts';
import {
	CAPABILITIES,
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
	type AirbornePosition
} from '#lib/modes/position.ts';
import { SPECIAL_SQUAWKS } from '#lib/modes/squawk.ts';
import { extendedSquitter, type Squitter } from '#lib/modes/squitter.ts';
import {
	EMERGENCY_STATES,
	NAC_P,
	SIL,
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

const TONE_ORDER = { main: 0, alert: 1, minor: 2 };

export function describe(data: Uint8Array): Field[] {
	const fields: Field[] = [];
	const header = messageHeader(data);
	if (header) fields.push(...headerFields(header));

	const squitter = extendedSquitter(data);
	if (squitter) fields.push(...squitterFields(squitter));

	const df = downlinkFormat(data);
	if (df === 16) fields.push(...mvFields(payload(data)!));
	if (df === 20 || df === 21) {
		fields.push({
			label: 'MB',
			value: 'Comm-B',
			title:
				"56 bits from one of the transponder's registers, read out by a radar. The message doesn't say which register: that has to be inferred (coming on /comm-b).",
			tone: 'minor'
		});
	}
	// Stable sort: headline values first, details last, each group in decoding order.
	return fields.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
}

// --- shared ------------------------------------------------------------------------------

const n = (x: number) => x.toLocaleString();

function altitudeField(altitude: Altitude, what = 'Barometric altitude'): Field {
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

function silField(sil: number): Field {
	return {
		label: 'SIL',
		value: String(sil),
		title: `Source integrity level: probability ${SIL[sil]} that the position is outside the containment radius without an alert`,
		tone: 'minor'
	};
}

const degrees = (x: number) => `${Math.round(x) % 360}°`;

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
	}
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

/** DF16: the MV field. In practice it holds a copy of a register, asked for air-to-air. */
function mvFields(mv: Uint8Array): Field[] {
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

function squitterFields(s: Squitter): Field[] {
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
		case 'aircraft-status':
			if (s.squawk === null) {
				return [
					{
						label: 'ST',
						value: String(s.subtype),
						title:
							s.subtype === 2
								? 'ACAS resolution advisory broadcast (not decoded yet)'
								: 'Reserved subtype',
						tone: 'alert'
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
		case 'target-state':
			return targetStateFields(s);
		case 'operational-status':
			return operationalStatusFields(s);
	}
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
			title: 'Integrity supplement bit; with the type code it refines the containment radius',
			tone: 'minor'
		});
	}
	return fields;
}

function cprFields(p: AirbornePosition): Field[] {
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
	fields.push({
		label: 'NACv',
		value: String(v.nacV),
		title: `Velocity accuracy: ${['unknown', '< 10 m/s', '< 3 m/s', '< 1 m/s', '< 0.3 m/s'][v.nacV] ?? 'reserved'}`,
		tone: 'minor'
	});
	return fields;
}

function targetStateFields(t: TargetState): Field[] {
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
		const active = [
			m.autopilot && 'AP',
			m.lnav && 'LNAV',
			m.vnav && 'VNAV',
			m.altitudeHold && 'ALT',
			m.approach && 'APP'
		].filter(Boolean);
		fields.push({
			label: 'modes',
			value: active.length ? active.join(' ') : 'none',
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
		silField(t.sil),
		{
			label: 'NICbaro',
			value: String(t.nicBaro),
			title: 'Barometric altitude cross-checked against a second source (1) or not (0)',
			tone: 'minor'
		}
	);
	return fields;
}

function operationalStatusFields(s: OperationalStatus): Field[] {
	const fields: Field[] = [
		{
			value: `ADS-B v${s.version}`,
			title: `Version ${s.version}: ${['DO-260', 'DO-260A', 'DO-260B'][s.version] ?? 'unknown'}. Decides how some other fields are read`,
			tone: 'main'
		},
		nacPField(s.nacP),
		silField(s.sil),
		{
			label: 'NIC-A',
			value: String(s.nicSupplementA),
			title: 'NIC supplement A: picks between the two containment radii of TC 11, 13 and 16',
			tone: 'minor'
		}
	];
	if (s.subtype !== 'airborne') {
		fields.push({ label: 'ST', value: String(s.subtype), title: 'Subtype', tone: 'minor' });
	}
	if (s.capabilities) {
		const c = s.capabilities;
		const can = [
			c.tcasOperational && 'TCAS',
			c.es1090In && '1090 in',
			c.uatIn && 'UAT in',
			c.arv && 'ARV',
			c.ts && 'TS',
			c.tc && 'TC'
		].filter(Boolean);
		fields.push({
			label: 'can',
			value: can.length ? can.join(' ') : 'none',
			title:
				'Capabilities: TCAS operational; receives ADS-B itself on 1090 MHz / 978 MHz UAT ("ADS-B In"); sends air-referenced velocity (ARV), target state (TS), trajectory change (TC) reports',
			tone: 'minor'
		});
	}
	if (s.modes) {
		const m = s.modes;
		fields.push({
			label: 'SDA',
			value: String(m.sda),
			title: 'System design assurance 0–3: how strictly the ADS-B equipment is certified',
			tone: 'minor'
		});
		if (m.singleAntenna) {
			fields.push({
				value: 'single antenna',
				title: 'Transmits from one antenna only (airliners have one on top and one below)',
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
