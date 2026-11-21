/**
 * The words for alerts (tracker/alerts.ts): a headline for the banner and notifications, a
 * badge for the map and the tab title, and the panel's section on what it means, what
 * happens next and what it rests on.
 *
 * Sources: ICAO Doc 4444 (PANS-ATM) §15.1 and §15.7.3 (emergencies, ACAS), Doc 8168
 * (PANS-OPS) Vol I on responding to an RA, SERA.14083 (radio failure in Europe), Annex 6
 * Part I (minimum fuel), DO-260B (TC 28’s emergency states).
 */
import { distanceKm } from '#lib/geo.ts';
import { KM_PER_NM } from '#lib/units.ts';
import { ADVISORY_MS, type Alert, type Cause } from '#lib/tracker/alerts.ts';
import type { Streak, TrackedAircraft } from '#lib/tracker/tracker.ts';
import { shownPosition } from '#lib/tracker/shown.ts';
import type { Section } from './aircraft';
import {
	advisoryInstruction,
	formatLink,
	provenanceText,
	registerLink,
	typeCodeLink
} from './field';
import { n, type Unit } from './format';

/** The callsign, or the address while there's none. */
export const nameOf = (a: TrackedAircraft | null, icao: string) => a?.callsign?.value ?? icao;

const CAUSES: Record<
	Cause,
	{ headline: string; badge: string; meaning: string; nextShort: string; next: string }
> = {
	general: {
		nextShort: 'priority, the nearest airport',
		headline: 'Emergency',
		badge: 'EMERG',
		meaning:
			'The crew has declared an emergency: "Mayday" on the radio, and 7700 on the transponder, which makes the aircraft stand out on every radar screen in range. Most are a passenger taken ill or a technical problem (an engine, the pressurisation, smoke, a warning that won’t go away), and most end with a normal landing.',
		next: 'It gets priority over everyone else: controllers move other traffic out of its way and clear it straight to the nearest suitable airport. Losing cabin pressure, it descends quickly to 10,000 ft, where the air is breathable. Once in contact, controllers often give it a normal code again, so a squawk back to normal doesn’t mean it’s over.'
	},
	radio: {
		nextShort: 'last level for 7 min, then its flight plan',
		headline: 'Radio failure',
		badge: 'NORDO',
		meaning:
			'The crew can’t talk to air traffic control: 7600 tells every radar "radio failure". Usually a broken radio or a wrong frequency set, rarely anything worse.',
		next: 'It follows a set procedure, so controllers know what it will do: in Europe it keeps its last assigned level and speed for 7 minutes, then flies its flight plan (SERA.14083), and controllers keep other traffic clear of it. They call it on other frequencies, including the emergency frequency 121.5 MHz. If contact isn’t restored, air forces may send fighters to take a look (quick reaction alert).'
	},
	hijack: {
		nextShort: 'ATC asks to confirm, quietly',
		headline: 'Unlawful interference',
		badge: 'HIJACK',
		meaning:
			'7500 means unlawful interference: a hijacking. The crew can set it without saying a word, so nobody on board hears them telling ATC. More often it’s a slip of the finger: 7500 instead of 7000 or 5700.',
		next: 'Controllers don’t mention it openly. They ask the crew to confirm the code; a crew that keeps it set has confirmed. Then the security authorities take over, and fighters may escort the aircraft.'
	},
	downed: {
		nextShort: 'search and rescue',
		headline: 'Downed aircraft',
		badge: 'DOWN',
		meaning:
			'Its transponder reports the aircraft as going down: a forced landing, or ditching in water. Almost never seen.',
		next: 'Search and rescue starts from the last known position. The emergency locator transmitter on board sends its own signal, on 406 MHz, to satellites.'
	},
	medical: {
		nextShort: 'direct route, priority landing',
		headline: 'Medical priority',
		badge: 'MED',
		meaning:
			'Its transponder reports "lifeguard/medical" (RTCA DO-260B): someone on board needs a doctor, or it’s an air ambulance in a hurry. Nothing is wrong with the aircraft itself: without the emergency code 7700 it’s a priority, not distress.',
		next: 'Controllers give it a more direct route and priority for landing; an ambulance meets it.'
	},
	fuel: {
		nextShort: 'no more delays',
		headline: 'Minimum fuel',
		badge: 'FUEL',
		meaning:
			'Its transponder reports minimum fuel: the crew has told air traffic control (ATC) that any further delay would mean landing with less than the final reserve, the fuel for 30 minutes of circling (ICAO Annex 6). Not an emergency yet.',
		next: 'Controllers avoid delaying it. If it’s going to land with less than the final reserve, the crew declares "Mayday fuel" and squawks 7700.'
	}
};

export function headline(x: Alert): string {
	if (x.kind === 'advisory') return `RA: ${advisoryInstruction(x.advisory).text}`;
	const { headline } = CAUSES[x.cause];
	return x.squawk ? `${headline} (squawk ${x.squawk})` : headline;
}

/** A few characters, for the map's label and the tab title. */
export function badge(x: Alert): string {
	if (x.kind === 'advisory') {
		const { sense } = advisoryInstruction(x.advisory);
		return sense === 'up' ? 'RA ↑' : sense === 'down' ? 'RA ↓' : 'RA';
	}
	return x.squawk ?? CAUSES[x.cause].badge;
}

/** For a system notification: title and one or two sentences. `threat`: an RA's other aircraft. */
export function notification(
	x: Alert,
	a: TrackedAircraft | null,
	threat: TrackedAircraft | null = null
): { title: string; body: string } {
	const title = `${nameOf(a, x.icao)}: ${headline(x)}`;
	if (x.kind === 'advisory')
		return {
			title,
			body: `Its collision avoidance system tells the pilots to ${advisoryInstruction(x.advisory).text}${x.threat ? `, against ${nameOf(threat, x.threat)}` : ''}.`
		};
	return { title, body: CAUSES[x.cause].meaning.split('. ')[0] + '.' };
}

const RA_MEANING =
	'ACAS, the airborne collision avoidance system (TCAS on the flight deck), worked out that another aircraft will come too close within the next 15–35 s, and tells the pilots how to avoid it. It interrogates the transponders around it itself, on 1030 MHz, and the two aircraft’s systems agree with each other, so they never pick the same direction: usually one climbs and the other descends.';
const RA_NEXT =
	'The pilots follow it within 5 seconds (2.5 s when it gets stronger or reverses), even against an ATC instruction, and tell ATC "TCAS RA". The controller gives it no more instructions until the crew reports "clear of conflict"; then it returns to its clearance. RAs rarely last longer than a minute. Many are "nuisance" RAs: two aircraft levelling off 1,000 ft apart at high vertical rates look to ACAS as if they won’t stop. (ICAO Doc 8168 Vol I, Doc 4444 §15.7.3)';

/** Where a streak came from, in words, the message type linked to /frames (or /comm-b). */
function sourceText(s: Streak<unknown>): string {
	const p = s.from;
	if (p.kind === 'adsb') return `ADS-B messages (${typeCodeLink(p.tc, p.to)})`;
	if (p.kind === 'reply') return `replies to radars (${formatLink(p.df)})`;
	if (p.kind === 'comm-b') return `a radar reading ${registerLink(p.bds)}`;
	return `the ${provenanceText(p)}`;
}

const CONFIRMATION =
	'One message alone doesn’t raise an alert: a corrupted radar reply can pass as a known aircraft’s, and a transponder with a knob per digit runs through other codes while a new one is dialled (7000 → 2700 passes 7700). So it takes two in a row.';

/** For advisories: no knob-turning example, a resolution advisory isn't dialled in. */
const RA_CONFIRMATION =
	'One message alone doesn’t raise an alert: a corrupted radar reply can pass as a known aircraft’s. So it takes two in a row.';

/** "2 min", "40 s". */
function duration(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	return s < 120 ? `${s} s` : `${Math.round(s / 60)} min`;
}

/**
 * The panel's section for one alert. `all`: every aircraft, for the RA's threat (where it is
 * relative to this one).
 */
export function alertSection(
	x: Alert,
	a: TrackedAircraft,
	all: TrackedAircraft[],
	now: number,
	unit: Unit
): Section & { tier: Alert['tier'] } {
	const fields: Section['fields'] = [];
	const since = new Date(x.since).toLocaleTimeString('en-GB');
	if (x.kind === 'emergency') {
		const c = CAUSES[x.cause];
		fields.push({ label: 'What', value: headline(x), title: c.meaning, tone: 'alert' });
		fields.push({ label: 'What happens next', value: c.nextShort, title: c.next, tone: 'main' });
		const sources = [
			x.squawk && a.squawk ? `The squawk ${x.squawk} from ${sourceText(a.squawk)}` : null,
			x.state !== null && a.emergency ? `the emergency state from ${sourceText(a.emergency)}` : null
		].filter(Boolean);
		const from = sources.join(', ');
		fields.push({
			label: 'Since',
			value: `${since} (${duration(now - x.since)})`,
			title: `When the first message saying so arrived. ${CONFIRMATION}`,
			footnote: from ? `${from[0].toUpperCase()}${from.slice(1)}.` : undefined,
			tone: 'main'
		});
	} else {
		const { text } = advisoryInstruction(x.advisory);
		fields.push({
			label: 'What',
			value: `RA: ${text}`,
			title: RA_MEANING,
			tone: 'alert'
		});
		fields.push({
			label: 'What happens next',
			value: 'the pilots follow it within 5 s',
			title: RA_NEXT,
			tone: 'main'
		});
		if (x.threat) {
			const other = all.find((o) => o.icao === x.threat) ?? null;
			fields.push({
				label: 'Threat',
				value: `${nameOf(other, x.threat)}${relation(a, other, now, unit)}`,
				title: `The aircraft ACAS is avoiding: the advisory names it by its address, ${x.threat}.${other ? '' : ' It’s out of this receiver’s range, or not heard yet.'}`,
				tone: 'main',
				mono: !other?.callsign
			});
		}
		fields.push({
			label: 'Since',
			value: `${since} (${duration(now - x.since)}, ${x.count} messages)`,
			title: `When the first message with this advisory arrived. The aircraft tells it three ways: in its own ADS-B messages, about once a second while it lasts; in its replies to the other aircraft's ACAS; and to a radar that asks. It's over when a message says it has ended, or after ${duration(ADVISORY_MS)} without one. ${RA_CONFIRMATION}`,
			footnote: `The latest came from ${a.advisory ? sourceText(a.advisory) : 'ADS-B'}.`,
			tone: 'main'
		});
	}
	return {
		title:
			x.kind === 'advisory'
				? 'Collision avoidance'
				: x.tier === 'emergency'
					? 'Emergency'
					: 'Priority',
		tier: x.tier,
		fields
	};
}

/** ", 1,000 ft below, 4.8 km": where the threat is, from what we know about both. */
function relation(
	a: TrackedAircraft,
	other: TrackedAircraft | null,
	now: number,
	unit: Unit
): string {
	if (!other) return '';
	const parts: string[] = [];
	if (a.altitude && other.altitude) {
		const d = other.altitude.value - a.altitude.value;
		parts.push(d === 0 ? 'same level' : `${n(Math.abs(d))} ft ${d > 0 ? 'above' : 'below'}`);
	}
	const p = shownPosition(a, now);
	const q = shownPosition(other, now);
	if (p && q) {
		const km = distanceKm(p, q);
		parts.push(unit === 'NM' ? `${(km / KM_PER_NM).toFixed(1)} NM` : `${km.toFixed(1)} km`);
	}
	return parts.length ? `, ${parts.join(', ')}` : '';
}

/** The IDENT row, while the pilot presses it. */
export function identField(): Section['fields'][number] {
	return {
		label: 'IDENT',
		value: 'pressed (SPI)',
		title:
			'The controller asked for an "ident", and the pilot pressed the IDENT button: for about 18 s the aircraft’s symbol stands out on the controller’s screen, so they can be sure which one it is (15–30 s in ICAO Annex 10, Vol. IV; 18 s in RTCA DO-181). Nothing is wrong.',
		tone: 'main'
	};
}
