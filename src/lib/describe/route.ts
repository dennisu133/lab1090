/**
 * The tracker panel's "Route · adsbdb" section: where the flight goes, who flies it, what
 * it's called on the radio, and whether the route fits what the aircraft does
 * (lib/tracker/route.ts). Everything here comes from a database, looked up by the callsign
 * (lib/aircraft-db.ts), not from the radio: the section's title says so, and the Check
 * explains why a route can be wrong. Route, airports and progress explain themselves.
 */
import type { DbAirline, DbAirport, DbFlight, DbRoute } from '#lib/aircraft-db.ts';
import { airlineDesignator } from '#lib/aircraft-db.ts';
import { KM_PER_NM } from '#lib/units.ts';
import {
	type Judged,
	MAX_DETOUR,
	MIN_DETOUR_KM,
	MIN_PROGRESS_WINDOW_MS,
	misfit,
	PROGRESS,
	type RouteCheck
} from '#lib/tracker/route.ts';
import type { TrackedAircraft } from '#lib/tracker/tracker.ts';
import type { Section } from './aircraft';
import { n, type Unit } from './format';

const dist = (km: number, unit: Unit) => `${n(unit === 'NM' ? km / KM_PER_NM : km)} ${unit}`;

/** Opens every check tooltip: why a route needs checking at all. */
const WHY_CHECK =
	"Nothing in the messages says where a flight goes. The route is looked up by callsign in adsbdb (collected by David Taylor and Jim Mason), and callsigns get reused, so it's checked against the aircraft's positions.";

/** "Valencia", else the airport's name, else its code: for the panel's header. */
export function place(a: DbAirport): string {
	return a.city || a.name || a.icao;
}

/** "Valencia → Berlin", "Valencia → Frankfurt → Berlin". */
export function routeText(r: DbRoute): string {
	return [r.origin, r.via, r.destination]
		.filter((a): a is DbAirport => a !== null)
		.map(place)
		.join(' → ');
}

const codes = (a: DbAirport) => [a.icao, a.iata].filter(Boolean).join(' · ');

function airportField(label: string, a: DbAirport): Section['fields'][number] {
	return {
		label,
		value: `${a.name || place(a)}${a.country ? `, ${a.country}` : ''} (${codes(a)})`,
		tone: 'main'
	};
}

/** ICAO's words for digits and letters (Annex 10, Vol. II, 5.2.1.3 and 5.2.1.4). */
const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
const LETTERS: Record<string, string> = {
	A: 'alfa',
	B: 'bravo',
	C: 'charlie',
	D: 'delta',
	E: 'echo',
	F: 'foxtrot',
	G: 'golf',
	H: 'hotel',
	I: 'india',
	J: 'juliett',
	K: 'kilo',
	L: 'lima',
	M: 'mike',
	N: 'november',
	O: 'oscar',
	P: 'papa',
	Q: 'quebec',
	R: 'romeo',
	S: 'sierra',
	T: 'tango',
	U: 'uniform',
	V: 'victor',
	W: 'whiskey',
	X: 'x-ray',
	Y: 'yankee',
	Z: 'zulu'
};

/** "LUFTHANSA" → "Lufthansa", "EASY" → "Easy". */
const titleCase = (s: string) =>
	s
		.toLowerCase()
		.replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());

/**
 * How the callsign is said on the radio: the airline's telephony designator, then the rest
 * character by character: EJU64BR with "Alpine" → "Alpine six four bravo romeo".
 */
function spoken(callsign: string, airline: DbAirline): string | null {
	if (!airline.radio || airlineDesignator(callsign) !== airline.icao) return null;
	const rest = [...callsign.slice(3).toUpperCase()].map((c) =>
		/\d/.test(c) ? DIGITS[Number(c)] : (LETTERS[c] ?? c)
	);
	return [titleCase(airline.radio), ...rest].join(' ');
}

function airlineFields(callsign: string, airline: DbAirline): Section['fields'] {
	const fields: Section['fields'] = [
		{
			label: 'Airline',
			value: `${airline.name} (${[airline.icao, airline.iata].filter(Boolean).join(' · ')})`,
			title: `From the callsign's first three letters, ${airline.icao}: the airline's code for air traffic control and flight plans (ICAO Doc 8585).${airline.country ? ` Its home: ${airline.country}.` : ''}`,
			tone: 'main'
		}
	];
	const words = spoken(callsign, airline);
	if (words)
		fields.push({
			label: 'On the radio',
			value: words,
			title: `On the radio the airline goes by "${airline.radio}" (ICAO Doc 8585), a word that's easy to make out through noise and not always the airline's name: British Airways is "Speedbird". The rest is spelled out in the aviation alphabet. It often isn't the flight number on the ticket: airlines pick letters and digits so that similar callsigns on one frequency don't get mixed up.`,
			tone: 'main'
		});
	return fields;
}

/** The rules, in a sentence. */
function howChecked(c: RouteCheck | null): string {
	const from = c ? place(c.leg.from) : 'the origin';
	const to = c ? place(c.leg.to) : 'the destination';
	return `To fit, the aircraft has to be near the way from ${from} to ${to}, and getting closer to ${to} or further from ${from}.`;
}

/** The limits, for the dimmed line under a check. */
function limitsText(unit: Unit): string {
	return `Near the way: going via the aircraft is at most ${MAX_DETOUR * 100} % longer than direct (${dist(MIN_DETOUR_KM, unit)} on short flights), as airways and detours allow. Getting closer: by at least ${PROGRESS * 100} % of the distance flown in the last minutes. Only positions count, not where the nose points: near airports, controllers send aircraft wherever traffic needs them.`;
}

/** "In the last 4 min it flew 30 NM, got 28 NM closer to Berlin and …". */
function movedText(c: RouteCheck, unit: Unit): string {
	const m = c.progress;
	if (!m) return '';
	const closer =
		m.closer >= 0 ? `${dist(m.closer, unit)} closer to` : `${dist(-m.closer, unit)} further from`;
	const away =
		m.away >= 0 ? `${dist(m.away, unit)} further from` : `${dist(-m.away, unit)} closer to`;
	return ` In the last ${Math.round(m.ms / 60_000)} min it flew ${dist(m.flown, unit)}, got ${closer} ${place(c.leg.to)} and ${away} ${place(c.leg.from)}.`;
}

/** "going via its position is 5 NM longer than direct (181 NM allowed)". */
const detourOf = (c: RouteCheck, unit: Unit) =>
	`going via its position is ${dist(c.detourKm, unit)} longer than direct (${dist(c.maxDetourKm, unit)} allowed)`;

/** Why a route doesn't fit (off-route or backwards), with the numbers. */
function misfitText(c: RouteCheck, unit: Unit): string {
	return c.verdict === 'off-route'
		? `it's too far off the way between ${place(c.leg.from)} and ${place(c.leg.to)}: ${detourOf(c, unit)}.`
		: `it's on the way, but going from ${place(c.leg.to)} to ${place(c.leg.from)}: outbound and return flights get mixed up.${movedText(c, unit)}`;
}

/** For a route that's shown: one that fits, or can't be judged yet (RouteJudge). */
function checkField(c: RouteCheck | null, unit: Unit): Section['fields'][number] {
	const how = `${WHY_CHECK} ${howChecked(c)}`;
	if (!c)
		return {
			label: 'Check',
			value: "can't tell (no position)",
			title: `${how}\n\nThere's no position yet.`,
			footnote: limitsText(unit),
			tone: 'minor'
		};
	if (c.verdict === 'fits')
		return {
			label: 'Check',
			value: 'fits',
			title: `${how}\n\nHere ${detourOf(c, unit)}.${movedText(c, unit)}`,
			footnote: limitsText(unit),
			tone: 'minor'
		};
	// 'unknown' (off-route and backwards never get here: those routes aren't shown).
	return {
		label: 'Check',
		value: "can't tell yet",
		title: `${how}\n\nIt's near the way (${detourOf(c, unit)}), but which way it's going isn't clear yet: ${c.progress ? 'in the last minutes it neither got closer to the destination nor further from the origin (turning, circling, or taxiing).' : `that takes at least ${MIN_PROGRESS_WINDOW_MS / 60_000} min of trail.`}${movedText(c, unit)}`,
		footnote: limitsText(unit),
		tone: 'minor'
	};
}

/**
 * Section title and fields; null if adsbdb knows neither the route nor the airline.
 * `judged`: the route check (RouteJudge); a route it dismissed shows as unknown.
 */
export function routeSection(
	a: TrackedAircraft,
	flight: DbFlight,
	judged: Judged | null,
	unit: Unit
): Section | null {
	const callsign = a.callsign?.value;
	const r = flight.route;
	if (!callsign || (!r && !flight.airline)) return null;
	const fields: Section['fields'] = [];
	const c = judged?.check ?? null;
	if (r && judged && !judged.shown && c) {
		fields.push({
			label: 'Route',
			value: 'unknown',
			title: `adsbdb lists ${routeText(r)} for the callsign ${callsign}, but ${misfitText(c, unit)} Callsigns get reused, so it's most likely another flight's route: not shown, and it doesn't come back when the aircraft turns.\n\n${howChecked(c)}`,
			footnote: limitsText(unit),
			tone: 'minor'
		});
	} else if (r) {
		fields.push({ label: 'Route', value: routeText(r), tone: 'main' });
		fields.push(airportField('From', r.origin));
		if (r.via) fields.push(airportField('Via', r.via));
		fields.push(airportField('To', r.destination));
		// How far along a route it isn't flying means nothing.
		if (c && !misfit(c)) {
			const done = c.fromKm / (c.fromKm + c.toGoKm);
			fields.push({
				label: 'Progress',
				value: `${Math.round(done * 100)} % · ${dist(c.toGoKm, unit)} to ${place(c.leg.to)}`,
				tone: 'minor'
			});
		}
		fields.push(checkField(c, unit));
	}
	if (flight.airline) fields.push(...airlineFields(callsign, flight.airline));
	return { title: r ? 'Route' : 'Airline', source: 'adsbdb', fields };
}
