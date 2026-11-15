/**
 * The tracker panel's "Route (adsbdb)" section: where the flight goes, who flies it, what
 * it's called on the radio, and whether the route fits what the aircraft does
 * (lib/tracker/route.ts). Everything here comes from a database, looked up by the callsign
 * (lib/aircraft-db.ts), not from the radio: each tooltip says so.
 */
import type { DbAirline, DbAirport, DbFlight, DbRoute } from '#lib/aircraft-db.ts';
import { airlineDesignator } from '#lib/aircraft-db.ts';
import { KM_PER_NM } from '#lib/geo.ts';
import type { Unit } from '#lib/map/features.ts';
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

const n = (x: number) => Math.round(x).toLocaleString('en');
const dist = (km: number, unit: Unit) => `${n(unit === 'NM' ? km / KM_PER_NM : km)} ${unit}`;

/** Said of every route value: where it came from and why it can be wrong. */
const FROM_ROUTES =
	" Not from the radio: nothing in the messages says where a flight goes. Looked up by the callsign in adsbdb.com (routes collected by David Taylor and Jim Mason). Callsigns get reused, and the database can lag behind: the check below compares the route with the aircraft's own positions.";

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

function airportField(label: string, a: DbAirport, role: string): Section['fields'][number] {
	return {
		label,
		value: `${a.name || place(a)}${a.country ? `, ${a.country}` : ''} (${codes(a)})`,
		title: `The ${role}. Two codes: the ICAO location indicator (${a.icao || '–'}, Doc 7910), four letters that pilots, flight plans and air traffic control use, the first one or two saying the region and country (ED = Germany, LE = Spain, EG = United Kingdom); and the IATA code (${a.iata ?? '–'}) on tickets and departure boards.${a.elevation !== null ? ` Elevation ${n(a.elevation)} ft (${n(a.elevation * 0.3048)} m) above sea level.` : ''}${FROM_ROUTES}`,
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
export function spoken(callsign: string, airline: DbAirline): string | null {
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
			title: `Who flies it, from the callsign's first three letters: the airline's ICAO designator (${airline.icao}, Doc 8585), which air traffic control and flight plans use. The two-character IATA code${airline.iata ? ` (${airline.iata})` : ''} is the one on tickets and departure boards. ${airline.country ? `Its home: ${airline.country}. ` : ''}Not from the radio: looked up in adsbdb.com.`,
			tone: 'main'
		}
	];
	const words = spoken(callsign, airline);
	if (words)
		fields.push({
			label: 'On the radio',
			value: words,
			title: `How the pilots and the controller say the callsign. The airline isn't called by its three letters but by its telephony designator, "${airline.radio}" (Doc 8585): a word that's easy to hear through noise and doesn't sound like another airline's. Not always the airline's name: easyJet's Austrian airline is "Alpine", British Airways is "Speedbird". The rest is spelled in ICAO's alphabet, digit by digit; "niner" so that nine doesn't sound like the German "nein". The characters after the designator often aren't the flight number on the ticket: airlines use letters and digits that differ from one flight to the next, so that two similar callsigns on the same frequency don't get mixed up.`,
			tone: 'main'
		});
	return fields;
}

/** The end of every check tooltip: the rules. */
function howChecked(c: RouteCheck | null): string {
	const from = c ? place(c.leg.from) : 'the origin';
	const to = c ? place(c.leg.to) : 'the destination';
	return `How it's checked, from positions only (never the heading: near airports controllers steer aircraft wherever the traffic needs them). Near the way: flying from ${from} to ${to} via where the aircraft is may be at most ${MAX_DETOUR * 100} % (at least ${MIN_DETOUR_KM} km) longer than the direct way: real flights follow airways and get sent round closed airspace and busy airports. The right way: over the last minutes of its trail it got closer to ${to} or further from ${from}, by at least ${PROGRESS * 100} % of the distance it flew. Backwards would be both the other way round.`;
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

/** "a detour of 5 NM via its position (181 NM allowed)". */
const detourOf = (c: RouteCheck, unit: Unit) =>
	`a detour of ${dist(c.detourKm, unit)} via its position (${dist(c.maxDetourKm, unit)} allowed)`;
const detourText = (c: RouteCheck, unit: Unit) => {
	const d = detourOf(c, unit);
	return `${d[0].toUpperCase()}${d.slice(1)}.`;
};

/** Why a route doesn't fit (off-route or backwards), with the numbers. */
function misfitText(c: RouteCheck, unit: Unit): string {
	return c.verdict === 'off-route'
		? `it's too far off the way between ${place(c.leg.from)} and ${place(c.leg.to)}. ${detourText(c, unit)}`
		: `it's on the way, but going from ${place(c.leg.to)} to ${place(c.leg.from)}: outbound and return flights get mixed up.${movedText(c, unit)}`;
}

const RULE = " A route that doesn't fit isn't shown at all: it's most likely another flight's.";

/** For a route that's shown: one that fits, or can't be judged yet (RouteJudge). */
function checkField(c: RouteCheck | null, unit: Unit): Section['fields'][number] {
	const how = howChecked(c) + RULE;
	if (!c)
		return {
			label: 'Check',
			value: "can't tell (no position)",
			title: `Whether the route fits can only be judged from the aircraft's positions, and there's none yet. ${how}`,
			tone: 'minor'
		};
	if (c.verdict === 'fits')
		return {
			label: 'Check',
			value: 'fits',
			title: `The route fits what the aircraft does: it's near the way and going the right way. ${detourText(c, unit)}${movedText(c, unit)} ${how}`,
			tone: 'minor'
		};
	// 'unknown' (off-route and backwards never get here: those routes aren't shown).
	return {
		label: 'Check',
		value: "can't tell yet",
		title: `It's near the way (${detourOf(c, unit)}), but which way it's going isn't clear yet: ${c.progress ? 'in the last minutes it neither clearly closed in on the destination nor left the origin behind (turning, holding, or taxiing).' : `that takes at least ${MIN_PROGRESS_WINDOW_MS / 60_000} min of trail.`}${movedText(c, unit)} ${how}`,
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
			title: `adsbdb lists ${routeText(r)} for the callsign ${callsign}, but that doesn't fit what this aircraft does: ${misfitText(c, unit)} Callsigns get reused and the database lags behind, so it's most likely another flight's route, and it isn't shown, here or on the map. Dismissed for good: once a route didn't fit, it doesn't come back when the aircraft turns. ${howChecked(c)}`,
			tone: 'minor'
		});
	} else if (r) {
		fields.push({
			label: 'Route',
			value: routeText(r),
			title: `Where this flight goes: the route flown under the callsign ${callsign}.${FROM_ROUTES}`,
			tone: 'main'
		});
		fields.push(airportField('From', r.origin, 'airport it took off from'));
		if (r.via) fields.push(airportField('Via', r.via, 'stop on the way'));
		fields.push(airportField('To', r.destination, 'airport it flies to'));
		// How far along a route it isn't flying means nothing.
		if (c && !misfit(c)) {
			const done = c.fromKm / (c.fromKm + c.toGoKm);
			fields.push({
				label: 'Progress',
				value: `${Math.round(done * 100)} % · ${dist(c.toGoKm, unit)} to ${place(c.leg.to)}`,
				title: `How far along it is: the straight-line (great circle) distances from ${place(c.leg.from)} to the aircraft and on to ${place(c.leg.to)}, ${dist(c.fromKm, unit)} and ${dist(c.toGoKm, unit)}. The direct way is ${dist(c.directKm, unit)}; the distance actually flown is longer (airways, departure and arrival routes). On the map: the dash-dotted line.${FROM_ROUTES}`,
				tone: 'minor'
			});
		}
		fields.push(checkField(c, unit));
	}
	if (flight.airline) fields.push(...airlineFields(callsign, flight.airline));
	return { title: r ? 'Route (adsbdb)' : 'Airline (adsbdb)', fields };
}
