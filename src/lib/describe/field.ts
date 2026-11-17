/**
 * A displayed value, and the field builders the frame, ADS-B and Comm-B descriptions share
 * (frame.ts, squitter.ts, comm-b.ts): altitude, squawk, accuracy and integrity levels, ACAS
 * resolution advisories.
 */
import { inEffect, splitAdvisory, type ResolutionAdvisory } from '#lib/modes/acas.ts';
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

/** What an RA tells the pilots, and which way: up, down, or neither (a speed limit). */
export function advisoryInstruction(r: ResolutionAdvisory): {
	text: string;
	sense: 'up' | 'down' | null;
} {
	if (!r.active) {
		// Several threats, passing above some and below others (acas.ts, splitAdvisory).
		const s = splitAdvisory(r);
		if (s.climb) return { text: 'climb (several threats)', sense: 'up' };
		if (s.descend) return { text: 'descend (several threats)', sense: 'down' };
		if (s.upward) return { text: 'don’t descend (several threats)', sense: 'up' };
		if (s.downward) return { text: 'don’t climb (several threats)', sense: 'down' };
		return { text: 'several threats', sense: null };
	}
	const sense = r.downward ? 'down' : 'up';
	if (!r.positive)
		// A vertical speed limit: keep the climb or descent below a rate, or stop it.
		return {
			text: r.corrective ? 'level off' : r.downward ? 'don’t climb' : 'don’t descend',
			sense: null
		};
	const verb = sense === 'up' ? 'climb' : 'descend';
	if (r.senseReversal) return { text: `${verb}, now (reversal)`, sense };
	if (r.increasedRate) return { text: `increase ${sense === 'up' ? 'climb' : 'descent'}`, sense };
	if (r.altitudeCrossing) return { text: `${verb}, crossing`, sense };
	return { text: verb, sense };
}

/** A resolution advisory: Comm-B 3,0, ADS-B TC 28 subtype 2, or a DF16 coordination reply. */
export function advisoryFields(r: ResolutionAdvisory): Field[] {
	// In effect: ARA bit 9 (one threat) or MTE (several, bit 9 clear: acas.ts splitAdvisory).
	if (!inEffect(r) && !r.terminated)
		return [{ value: 'no RA', title: 'No resolution advisory right now', tone: 'minor' }];
	const several = splitAdvisory(r);
	// Corrective: the pilots must change what they're doing. A "positive" climb or descent
	// always is, whatever bit 10 says; with several threats a correction alone only limits
	// the vertical speed.
	const corrective = r.active ? r.corrective || r.positive : several.climb || several.descend;
	const fields: Field[] = [
		{
			value: r.terminated ? 'RA ended' : `RA: ${advisoryInstruction(r).text}`,
			title: r.terminated
				? 'The resolution advisory has just ended (RAT): the pilots return to their clearance'
				: corrective
					? 'ACAS resolution advisory, corrective: the pilots must change their climb or descent now, as shown, to miss another aircraft'
					: 'ACAS resolution advisory, preventive: the pilots must avoid the climb or descent shown; no manoeuvre needed as long as they do',
			tone: 'alert'
		}
	];
	if (r.threat?.type === 'address')
		fields.push({
			label: 'threat',
			value: r.threat.icao,
			title: 'ICAO address of the aircraft ACAS is avoiding (threat identity)',
			tone: 'alert',
			mono: true
		});
	return fields;
}
