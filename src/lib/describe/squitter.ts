/**
 * The ADS-B part of the Content columns: what each kind of extended squitter (DF17/18, and
 * the ADS-B registers a radar reads out via Comm-B) carries, as labelled values with
 * tooltips. The frame around it (header, DF18/19 formats, positions) is in frame.ts.
 */
import { typeCodeName } from '#lib/modes/frame.ts';
import {
	SURVEILLANCE_STATUS,
	type AirbornePosition,
	type Cpr,
	type SurfacePosition
} from '#lib/modes/position.ts';
import type { Squitter } from '#lib/modes/squitter.ts';
import {
	EMERGENCY_STATES,
	type AircraftStatus,
	type OperationalStatus,
	type TargetState
} from '#lib/modes/status.ts';
import type { Velocity } from '#lib/modes/velocity.ts';
import {
	advisoryFields,
	altitudeField,
	nacPField,
	silField,
	squawkField,
	type Field
} from './field';
import { directionText, flightLevel, n, signed } from './format';

export function squitterFields(s: Squitter): Field[] {
	switch (s.kind) {
		case 'identification':
			return [
				{
					value: s.callsign,
					title:
						"Callsign, as the crew entered it: the airline's designator and a flight number, or the registration",
					tone: 'main',
					mono: true
				},
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
	const kt = (x: number) => x.toLocaleString('en', { maximumFractionDigits: 2 });
	fields.push({
		value:
			m.speed === null
				? 'speed n/a'
				: m.stopped
					? 'stopped'
					: m.speed.max === null
						? `> ${m.speed.min} kt`
						: `${kt(m.speed.min)}–${kt(m.speed.max)} kt`,
		title: `Ground speed, movement code ${m.code}: a non-linear scale: 1/8 kt steps below 1 kt, ½ kt up to 15 kt, 1 kt up to 70 kt, 5 kt above 100 kt. Codes 2–8 changed in ADS-B version 2; read as version 2`,
		tone: m.speed === null ? 'minor' : 'main'
	});
	fields.push(
		p.track === null
			? { label: 'trk', value: 'n/a', title: 'Ground track not available', tone: 'minor' }
			: {
					value: directionText(p.track),
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
				'Version 2: NIC supplement B, with the type code and NIC-A it picks the containment radius. Versions 0/1: the single antenna flag. In relayed TIS-B/ADS-R messages: the IMF bit',
			tone: 'minor'
		});
	}
	return fields;
}

export function cprFields(p: { cpr: Cpr | null }): Field[] {
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
				value: directionText(v.ground.track),
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
				value: v.air.heading === null ? 'n/a' : directionText(v.air.heading),
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
			value: `${signed(v.gnssMinusBaro, 0)} ft`,
			title:
				'GNSS height minus barometric altitude. Barometric altitude assumes the standard atmosphere, so the difference grows with warmer air and higher surface pressure, plus the geoid height (GNSS heights are above the WGS84 ellipsoid)',
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
			title: `Selected altitude, from the ${t.selectedAltitude.source === 'FMS' ? 'flight management system' : 'autopilot control panel (MCP/FCU)'}: where the aircraft will level off, as the crew set it (normally the cleared level). 32 ft steps, so 38,016 means 38,000`,
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
			value: directionText(t.selectedHeading),
			title:
				'Heading set on the autopilot panel. Flown only in heading mode, not while following the route (LNAV). True or magnetic, as HRD in TC 31 says',
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
				'Target state, ADS-B version 1 layout (subtype 0): the altitude and heading the aircraft is flying towards',
			tone: 'minor'
		}
	];
	const v = t.vertical;
	if (v) {
		fields.push({
			label: 'target',
			value: v.type === 'flight level' ? flightLevel(v.altitude) : `${n(v.altitude)} ft`,
			title: `Target altitude, from ${v.source} (${MODE_TEXT[v.mode]}), ${v.type === 'flight level' ? 'a flight level (pressure altitude)' : 'above mean sea level'}. 100 ft steps`,
			tone: 'main'
		});
	}
	const h = t.horizontal;
	if (h) {
		fields.push({
			label: `target ${h.type === 'track' ? 'trk' : 'hdg'}`,
			value: directionText(h.angle),
			title: `Target ${h.type}, from ${h.source} (${MODE_TEXT[h.mode]})`,
			tone: 'main'
		});
	}
	if (t.acas.operational !== null) {
		fields.push({
			label: 'TCAS',
			value: t.acas.operational ? 'on' : 'off',
			title: 'Collision avoidance system operational',
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

/** SDA 0–3 (DO-260B, TC 31): probability of undetected faulty data, per flight hour. */
const SDA = ['unknown, or more than 1e-3', '≤ 1e-3', '≤ 1e-5', '≤ 1e-7'];

/** DO-260B 2.2.3.2.7.2.8: GVA 0–3. */
const GVA = ['unknown or > 150 m', '≤ 150 m', '≤ 45 m', 'reserved'];

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
			title:
				s.version === 1
					? 'NIC supplement: picks between the containment radii of TC 7, 11, 13 and 16'
					: 'NIC supplement A: with the type code and NIC-B (airborne) or NIC-C (surface), picks the containment radius of TC 7, 8, 11, 13 and 16',
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
			title:
				'Barometric altitude quality (version 1): transponders are meant to send 0 here, so this value is unusual',
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
				title:
					'NIC supplement C: with NIC-A, picks the containment radius of surface positions in TC 8',
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
				title: `System design assurance ${m.sda}: probability per flight hour that an equipment fault sends wrong position data undetected: ${SDA[m.sda]}`,
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
