/**
 * What /comm-b shows: register contents, comparisons with ADS-B, and how the register was
 * inferred, as Fields (see frame.ts) and tooltip text.
 */
import { mismatch, type Comparison, type How, type Inference } from '#lib/modes/comm-b.ts';
import { REGISTER_NAMES, type Register } from '#lib/modes/registers.ts';
import { squitterFields, type Field } from './frame';

/** All register names, including the ADS-B ones that are only seen broadcast here. */
export const NAMES: Record<string, string> = {
	...REGISTER_NAMES,
	'0,5': 'Airborne position',
	'0,6': 'Surface position',
	'0,8': 'Identification and category',
	'0,9': 'Airborne velocity',
	'6,1': 'Aircraft status (emergency)',
	'6,2': 'Target state and status',
	'6,5': 'Operational status'
};

/** Which register an ADS-B message is a copy of, by its type code. */
export function broadcastRegister(tc: number): string | null {
	if (tc >= 1 && tc <= 4) return '0,8';
	if (tc >= 5 && tc <= 8) return '0,6';
	if ((tc >= 9 && tc <= 18) || (tc >= 20 && tc <= 22)) return '0,5';
	return { 19: '0,9', 28: '6,1', 29: '6,2', 31: '6,5' }[tc] ?? null;
}

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

const n = (x: number) => x.toLocaleString();
const deg = (x: number) => `${Math.round(x) % 360}°`;
const signedRate = (x: number) => `${x > 0 ? '+' : ''}${n(x)} ft/min`;

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
					.map(([, value, title]) => ({ value, title, tone: 'minor' as const }))
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
					title: r.supported.map((bds) => `${bds}: ${NAMES[bds] ?? '?'}`).join('\n'),
					tone: 'minor',
					mono: true
				}
			];
		case '2,0':
			return [
				{ value: r.callsign, title: 'Callsign, as the crew entered it', tone: 'main', mono: true }
			];
		case '3,0': {
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
								deg(r.track),
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
								deg(r.heading),
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
		case '0,5':
		case '0,8':
		case '0,9':
			return squitterFields(r.squitter);
	}
}

function field(label: string, value: string, title: string, tone: Field['tone']): Field {
	return { ...(label && { label }), value, title, tone };
}

// --- comparisons -------------------------------------------------------------------------

function format(value: number | string, c: Comparison): string {
	if (typeof value === 'string') return value;
	const digits = c.unit === '' ? 3 : c.unit === 'hPa' ? 1 : 0;
	const text = value.toLocaleString(undefined, { maximumFractionDigits: digits });
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
