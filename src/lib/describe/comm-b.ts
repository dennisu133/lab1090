/**
 * What /comm-b shows: register contents, comparisons with ADS-B, and how the register was
 * inferred, as Fields (field.ts) and tooltip text.
 */
import {
	mismatch,
	type Candidate,
	type Comparison,
	type How,
	type Inference
} from '#lib/modes/comm-b.ts';
import {
	HAZARD_LEVELS,
	type DataLinkCapability,
	METEO_SOURCES,
	REGISTER_NAMES,
	type MeteoHazard,
	type MeteoRoutine,
	type Register
} from '#lib/modes/registers.ts';
import { advisoryFields, type Field } from './field';
import { directionText, n, signed } from './format';
import { squitterFields } from './squitter';

export const HOW: Record<How, { label: string; title: string }> = {
	empty: { label: 'empty', title: 'All 56 bits are zero: the register holds no data.' },
	fixed: {
		label: 'by pattern',
		title: 'Starts with its own register number (or, for 1,7, ends in 32 zero bits).'
	},
	'only candidate': {
		label: 'only fit',
		title: 'Every other register is ruled out by its structure.'
	},
	'ADS-B': {
		label: 'by ADS-B',
		title: 'More than one register fit; the reading that agrees with ADS-B won.'
	},
	ambiguous: {
		label: 'ambiguous',
		title: 'More than one register fits, and nothing decides between them.'
	},
	unknown: { label: 'unknown', title: 'No register fits these bits.' }
};

/** The whole reasoning, for a tooltip: what was picked, how, and why not the others. */
export function inferenceTitle(inference: Inference): string {
	const lines = [];
	if (inference.best) lines.push(`${inference.best.bds} ${inference.best.name}`);
	lines.push(HOW[inference.how].title);
	if (inference.candidates.length > 1)
		lines.push(`Fitted: ${inference.candidates.map((c) => c.bds).join(', ')}`);
	if (inference.rejected.length > 0) {
		lines.push('', 'Ruled out:');
		for (const r of inference.rejected) lines.push(`${r.bds}: ${r.reason}`);
	}
	return lines.join('\n');
}

// --- register contents -------------------------------------------------------------------

const signedRate = (x: number) => `${signed(x, 0)} ft/min`;

export function registerFields(r: Register): Field[] {
	switch (r.bds) {
		case '1,0': {
			const acas = r.acasRa ? 'ACAS RA' : r.acasOperational ? 'ACAS TA' : null;
			return [
				{
					label: 'subnet',
					value: `v${r.subnetworkVersion}`,
					title: `Mode S subnetwork version ${r.subnetworkVersion}: which edition of the data link protocol the transponder speaks`,
					tone: 'main'
				},
				{
					value: r.level5 ? 'level 5' : 'level 2–4',
					title: r.level5
						? 'Level 5 transponder: can talk to several ground stations at once'
						: 'Level 2–4 transponder (not level 5)',
					tone: 'main'
				},
				...(acas
					? [
							{
								value: acas,
								title: r.acasRa
									? 'Has ACAS (TCAS II): can tell the pilots to climb or descend to avoid a collision'
									: 'ACAS operational, traffic advisories only',
								tone: 'minor' as const
							}
						]
					: []),
				...(
					[
						[r.squitter, 'ES', 'Sends extended squitter (ADS-B)'],
						[r.identification, 'ident', 'Can report its callsign (register 2,0)'],
						[r.surveillanceIdentifier, 'SI', 'Understands surveillance identifier codes'],
						[r.overlay, 'overlay', 'Can XOR the register number into the parity']
					] as const
				)
					.filter(([on]) => on)
					.map(([, value, title]) => ({ value, title, tone: 'minor' as const })),
				{ value: 'other bits', title: otherCapabilityBits(r), tone: 'minor' }
			];
		}
		case '1,7':
			return [
				{
					value: `${r.supported.length} registers`,
					title: 'How many registers this transponder says a radar can read',
					tone: 'main'
				},
				{
					value: r.supported.join(' '),
					title: r.supported.map((bds) => `${bds}: ${REGISTER_NAMES[bds] ?? '?'}`).join('\n'),
					tone: 'minor',
					mono: true
				}
			];
		case '2,0':
			return [
				{
					value: r.callsign,
					title:
						"Callsign, as the crew entered it: the airline's designator and a flight number, or the registration",
					tone: 'main',
					mono: true
				}
			];
		case '2,1': {
			const fields: Field[] = [
				{
					value: r.registration,
					title:
						'Registration ("tail number"), as painted on the aircraft but without the dash: the 6-bit alphabet has none, so DAIZA is D-AIZA. The dash goes back after the nationality mark of the State the address belongs to.',
					tone: 'main',
					mono: true
				}
			];
			if (r.airline !== null)
				fields.push({
					label: 'airline',
					value: r.airline,
					title:
						'"ICAO airline registration marking": two characters that ICAO Doc 9871 provides for, which most transponders leave empty',
					tone: 'minor',
					mono: true
				});
			return fields;
		}
		case '3,0':
			return advisoryFields(r);
		case '4,0': {
			const fields: Field[] = [];
			if (r.mcpAltitude !== null)
				fields.push({
					label: 'MCP',
					value: `${n(r.mcpAltitude)} ft`,
					title: 'Selected altitude, dialled in on the autopilot panel (MCP/FCU)',
					tone: 'main'
				});
			if (r.fmsAltitude !== null)
				fields.push({
					label: 'FMS',
					value: `${n(r.fmsAltitude)} ft`,
					title: 'Altitude the flight management computer plans to fly',
					tone: 'main'
				});
			if (r.baroSetting !== null)
				fields.push({
					label: 'QNH',
					value: `${r.baroSetting.toFixed(1)} hPa`,
					title:
						'Altimeter setting, in 0.1 hPa steps (ADS-B uses 0.8). 1013.2 = standard pressure, used above the transition altitude',
					tone: 'minor'
				});
			if (r.modes) {
				for (const [on, mode, what] of [
					[r.modes.vnav, 'VNAV', 'vertical navigation (FMS controls the climb/descent)'],
					[r.modes.altitudeHold, 'ALT', 'altitude hold'],
					[r.modes.approach, 'APP', 'approach']
				] as const) {
					if (on) fields.push({ value: mode, title: `Autopilot mode: ${what}`, tone: 'minor' });
				}
			}
			if (r.targetSource !== null)
				fields.push({
					label: 'target',
					value: r.targetSource,
					title: 'Which altitude the aircraft is actually flying towards',
					tone: 'minor'
				});
			return fields;
		}
		case '5,0':
			return [
				...(r.groundSpeed !== null
					? [field('GS', `${r.groundSpeed} kt`, 'Ground speed, 2 kt steps', 'main')]
					: []),
				...(r.track !== null
					? [
							field(
								'TRK',
								directionText(r.track),
								`True track over the ground: ${r.track.toFixed(1)}°`,
								'main'
							)
						]
					: []),
				...(r.tas !== null
					? [field('TAS', `${r.tas} kt`, 'True airspeed: speed through the air', 'main')]
					: []),
				...(r.roll !== null
					? [
							field(
								'roll',
								`${Math.abs(r.roll).toFixed(1)}° ${r.roll > 0 ? 'R' : r.roll < 0 ? 'L' : ''}`.trim(),
								'Bank angle: which wing is down',
								'minor'
							)
						]
					: []),
				...(r.trackRate !== null
					? [
							field(
								'turn',
								`${r.trackRate.toFixed(2)}°/s`,
								'Track angle rate: how fast the track changes; positive = turning right',
								'minor'
							)
						]
					: [])
			];
		case '6,0':
			return [
				...(r.heading !== null
					? [
							field(
								'HDG',
								directionText(r.heading),
								`Magnetic heading, where the nose points: ${r.heading.toFixed(1)}°`,
								'main'
							)
						]
					: []),
				...(r.ias !== null
					? [
							field(
								'IAS',
								`${r.ias} kt`,
								'Indicated airspeed: what the cockpit airspeed indicator shows',
								'main'
							)
						]
					: []),
				...(r.mach !== null
					? [
							field(
								'M',
								r.mach.toFixed(3),
								'Mach number: true airspeed relative to the speed of sound',
								'main'
							)
						]
					: []),
				...(r.baroRate !== null
					? [
							field(
								'VR',
								signedRate(r.baroRate),
								'Vertical rate from air pressure (barometric)',
								'minor'
							)
						]
					: []),
				...(r.inertialRate !== null
					? [
							field(
								'VR ins',
								signedRate(r.inertialRate),
								'Vertical rate from the inertial reference system (accelerometers): reacts faster than the barometric one',
								'minor'
							)
						]
					: [])
			];
		case '5,1':
			return [
				{
					value: `${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}`,
					title:
						'Latitude, longitude from the flight computer, truncated to 360/2^20° (about 38 m). Plain numbers, not CPR. Layout inferred from data',
					tone: 'main',
					mono: true
				},
				field('', `${n(r.altitude)} ft`, 'Pressure altitude, 8 ft steps', 'main')
			];
		case '5,2':
			return [
				{
					label: 'fine',
					value: `${r.latFine.toFixed(6)}, ${r.lonFine.toFixed(6)}`,
					title:
						"Latitude and longitude modulo 1.40625° (360/256), to 360/2^26° (0.6 m): the digits after 5,1's. Placed into the right 1.40625° window with the ADS-B position. Layout inferred from data",
					tone: 'main',
					mono: true
				},
				field(
					'',
					`${n(r.altitude)} ft`,
					'Altitude, 8 ft steps: barometric for some aircraft, GNSS height for others (see the comparison)',
					'main'
				),
				field(
					'src',
					String(r.source),
					'Bits 2–5: probably where the position comes from (GNSS, inertial, …). Meaning unknown',
					'minor'
				)
			];
		case '4,4':
			return meteoRoutineFields(r);
		case '4,5':
			return meteoHazardFields(r);
		case '5,3':
			return [
				...(r.heading !== null
					? [
							field(
								'HDG',
								directionText(r.heading),
								`Magnetic heading, where the nose points: ${r.heading.toFixed(1)}°`,
								'main'
							)
						]
					: []),
				...(r.ias !== null
					? [
							field(
								'IAS',
								`${r.ias} kt`,
								'Indicated airspeed: what the cockpit airspeed indicator shows',
								'main'
							)
						]
					: []),
				...(r.mach !== null
					? [field('M', r.mach.toFixed(3), 'Mach number, 0.008 steps', 'main')]
					: []),
				...(r.tas !== null
					? [field('TAS', `${r.tas} kt`, 'True airspeed: speed through the air', 'main')]
					: []),
				...(r.verticalRate !== null
					? [
							field(
								'VR',
								signedRate(r.verticalRate),
								'Altitude rate: how fast it climbs or descends',
								'minor'
							)
						]
					: [])
			];
		case '0,5':
		case '0,6':
		case '0,8':
		case '0,9':
		case '6,1':
		case '6,2':
		case '6,5':
			return squitterFields(r.squitter);
	}
}

/**
 * The 1,0 bits that rarely matter to a listener, for a tooltip. Bit numbers and meanings:
 * ICAO Doc 9871 Table A-2-16 (and pyModeS's bds10.py, which follows it).
 */
function otherCapabilityBits(r: DataLinkCapability): string {
	const yes = (on: boolean) => (on ? 'yes' : 'no');
	return [
		'The rest of the capability report:',
		`Bit 9, continuation (the report goes on in register 1,1): ${yes(r.continuation)}`,
		`Bit 25, specific services (data link services beyond surveillance): ${yes(r.specificServices)}`,
		`Bits 26–28 / 29–32, ELM throughput (extended length messages: up to 16 segments of 80 bits, for data link; 0 = none): up ${r.uplinkElm}, down ${r.downlinkElm}`,
		`Bit 36, 1,7 toggle (flips whenever register 1,7 changes, so a radar knows to read it again): ${Number(r.gicbChanged)}`,
		`Bit 37, ACAS hybrid surveillance (uses ADS-B to interrogate other aircraft less often): ${yes(r.acasHybrid)}`,
		`Bits 39–40, ACAS version code (which edition of the ACAS standard, RTCA DO-185, it follows): ${r.acasVersion}`,
		`Bits 41–56, DTE status (which of 16 data terminal sub-addresses, for ELM, are in service): ${r.dteStatus.toString(16).padStart(4, '0')}`
	].join('\n');
}

/**
 * The 56 bits as binary, 8 per line with their bit numbers (1 = first, as in the spec
 * tables), so a reasoning like "status bit 12 is 0" can be checked by eye.
 */
export function bitsTitle(hex: string, name: 'MB' | 'ME'): string {
	const lines = [`${name} field (56 bits) in binary:`];
	for (let i = 0; i < 7; i++) {
		const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
			.toString(2)
			.padStart(8, '0');
		const range = `${i * 8 + 1}–${i * 8 + 8}`.padStart(5, ' ');
		lines.push(`${range}  ${byte.slice(0, 4)} ${byte.slice(4)}`);
	}
	return lines.join('\n');
}

/** An ambiguous reply: every reading it could be, each headed by its register. */
export function ambiguousFields(candidates: Candidate[]): Field[] {
	return candidates.flatMap((c, i) => [
		{
			value: `${i === 0 ? '' : 'or '}${c.bds}?`,
			title: `If this is ${c.bds} ${c.name}, it reads as follows`,
			tone: 'alert' as const,
			mono: true
		},
		...registerFields(c.register)
	]);
}

function temperatureField(celsius: number): Field {
	return field(
		'SAT',
		`${celsius.toFixed(2)} °C`,
		'Static air temperature: the temperature of the air around the aircraft (not heated by the speed), 0.25 °C steps',
		'main'
	);
}

function pressureField(hPa: number): Field {
	return field(
		'p',
		`${hPa} hPa`,
		'Average static pressure of the air around the aircraft',
		'minor'
	);
}

function hazardField(label: string, level: number, what: string): Field {
	return field(
		label,
		HAZARD_LEVELS[level],
		`${what}, as the aircraft reports it: nil, light, moderate or severe`,
		level > 0 ? 'alert' : 'minor'
	);
}

function meteoRoutineFields(r: MeteoRoutine): Field[] {
	const fields: Field[] = [];
	if (r.wind)
		fields.push(
			field(
				'wind',
				`${directionText(r.wind.direction)} ${r.wind.speed} kt`,
				`Wind from ${r.wind.direction.toFixed(1)}° (true north, where it blows from), ${r.wind.speed} kt. Measured by the aircraft`,
				'main'
			)
		);
	fields.push(temperatureField(r.temperature));
	if (r.pressure !== null) fields.push(pressureField(r.pressure));
	if (r.turbulence !== null) fields.push(hazardField('turb', r.turbulence, 'Turbulence'));
	if (r.humidity !== null)
		fields.push(
			field('RH', `${Math.round(r.humidity)} %`, 'Relative humidity, 100/64 % steps', 'minor')
		);
	fields.push(
		field(
			'FOM',
			METEO_SOURCES[r.source] ?? String(r.source),
			'Figure of merit: where the navigation data behind the wind comes from',
			'minor'
		)
	);
	return fields;
}

function meteoHazardFields(r: MeteoHazard): Field[] {
	const fields: Field[] = [];
	for (const [level, label, what] of [
		[r.turbulence, 'turb', 'Turbulence'],
		[r.windShear, 'shear', 'Wind shear'],
		[r.microburst, 'microburst', 'Microburst (a violent downdraft under a storm)'],
		[r.icing, 'icing', 'Icing'],
		[r.wakeVortex, 'wake', 'Wake vortex: the turbulence another aircraft leaves behind']
	] as const) {
		if (level !== null) fields.push(hazardField(label, level, what));
	}
	if (r.temperature !== null) fields.push(temperatureField(r.temperature));
	if (r.pressure !== null) fields.push(pressureField(r.pressure));
	if (r.radioHeight !== null)
		fields.push(
			field(
				'radio',
				`${n(r.radioHeight)} ft`,
				'Radio height: height above the ground, measured by the radar altimeter, 16 ft steps',
				'minor'
			)
		);
	if (fields.length === 0)
		fields.push(field('', 'no hazards reported', 'Every field says "no data"', 'minor'));
	return fields;
}

function field(label: string, value: string, title: string, tone: Field['tone']): Field {
	return { ...(label && { label }), value, title, tone };
}

// --- comparisons -------------------------------------------------------------------------

function format(value: number | string, c: Comparison): string {
	if (typeof value === 'string') return value;
	const digits = c.unit === '' ? 3 : c.unit === 'hPa' ? 1 : 0;
	const text = value.toLocaleString('en', { maximumFractionDigits: digits });
	return c.unit === '' || c.unit === '°' ? `${text}${c.unit}` : `${text} ${c.unit}`;
}

function age(c: Comparison): string {
	return c.ageMs === null ? '' : ` ${(c.ageMs / 1000).toFixed(1)} s earlier`;
}

export function comparisonFields(comparisons: Comparison[]): Field[] {
	return comparisons.map((c) => {
		if (c.quantity === 'all 56 bits') {
			return {
				value: '✓ = DF17',
				title: `All 56 bits identical to an ADS-B message the aircraft broadcast${age(c)}`,
				tone: 'minor'
			};
		}
		const difference =
			c.difference === null || c.difference === 0 ? '' : ` Δ${format(c.difference, c)}`;
		const title =
			c.unit === 'km'
				? `Position ${c.difference!.toFixed(2)} km from the ADS-B position (${c.from}${age(c)}); allowed: ${c.tolerance.toFixed(1)} km`
				: `Comm-B: ${format(c.commB, c)}. ${c.from}${age(c)}: ${format(c.other, c)}.` +
					(c.difference === null ? '' : ` Allowed difference: ${format(c.tolerance, c)}`);
		return {
			value: c.ok ? `✓ ${c.quantity}${difference}` : `✗ ${mismatch(c)}`,
			title,
			tone: c.ok ? 'minor' : 'alert'
		};
	});
}
