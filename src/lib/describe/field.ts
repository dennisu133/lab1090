/**
 * A displayed value, and the field builders the frame, ADS-B and Comm-B descriptions share
 * (frame.ts, squitter.ts, comm-b.ts): altitude, squawk, accuracy and integrity levels, ACAS
 * resolution advisories.
 */
import type { ResolutionAdvisory } from '#lib/modes/acas.ts';
import type { Altitude } from '#lib/modes/altitude.ts';
import { SPECIAL_SQUAWKS } from '#lib/modes/squawk.ts';
import { NAC_P, SIL } from '#lib/modes/status.ts';

export interface Field {
	/** Short label before the value, e.g. "SL". */
	label?: string;
	value: string;
	/** Tooltip: what this is, in words. */
	title: string;
	/** main: the headline values. minor: details, dimmed. alert: worth noticing. */
	tone: 'main' | 'minor' | 'alert';
	mono?: boolean;
	/** A flag before the value: ISO 3166-1 alpha-2 code and the State's name. */
	flag?: { country: string | null; name: string };
}

export const n = (x: number) => x.toLocaleString();

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

export function squawkField(code: string): Field {
	const special = SPECIAL_SQUAWKS[code];
	return {
		label: 'sqk',
		value: code,
		title: `Squawk (Mode A code) ${code}${special ? `: ${special.meaning}${special.detail ? ` (${special.detail})` : ''}` : ', assigned by ATC'}`,
		tone: special?.emergency ? 'alert' : 'main',
		mono: true
	};
}

export function nacPField(nacP: number): Field {
	return {
		label: 'NACp',
		value: String(nacP),
		title:
			nacP === 0
				? 'Navigation accuracy (position): unknown, or 10 NM or worse'
				: `Navigation accuracy (position): 95 % of the time within ${NAC_P[nacP] ?? '?'}`,
		tone: 'minor'
	};
}

export function silField(sil: number, supplement: number | null = null): Field {
	const per = supplement === null ? '' : supplement ? ' per sample' : ' per flight hour';
	return {
		label: 'SIL',
		value: String(sil),
		title:
			sil === 0
				? 'Source integrity level: unknown, or a probability above 1e-3 that the position is outside the containment radius without an alert'
				: `Source integrity level: probability ${SIL[sil]}${per} that the position is outside the containment radius without an alert`,
		tone: 'minor'
	};
}

export const degrees = (x: number) => `${Math.round(x) % 360}°`;

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
