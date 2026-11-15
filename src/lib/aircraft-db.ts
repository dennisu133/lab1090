/**
 * What a database knows about an aircraft and its flight: the airframe, looked up by its
 * 24-bit address (type, registration, owner, a photo), and the route, looked up by its
 * callsign (airline, origin, destination). None of this is in the radio messages: ADS-B only
 * says the weight class (emitter category), the registration only comes from Comm-B 2,1,
 * which hardly any radar asks for, and nothing at all says where a flight goes. So it's the
 * one thing here that isn't decoded, and the panel says so.
 *
 * Source: adsbdb (https://www.adsbdb.com, open source, MIT, by Jack Wills), aircraft data from
 * PlaneBase, photos from airport-data.com, routes by David Taylor (Edinburgh) and Jim Mason
 * (Glasgow). Free, no key, CORS open, so the browser asks it directly: the address, the
 * callsign and your IP go to adsbdb, and the photo comes from airport-data. Planespotters.net
 * has better photos but answered nothing from this app's page (and wants a contact address
 * from servers).
 *
 * The route data "may not be copied, published, or incorporated into other databases without
 * the explicit permission" of David Taylor (adsbdb's README). Asking live and showing it is
 * what adsbdb is for; storing it is not: nothing here keeps it beyond the tab, and the tests
 * use invented routes.
 *
 * GET https://api.adsbdb.com/v0/aircraft/{hex} →
 *   200 {"response":{"aircraft":{"type":"A321 271NXSL","icao_type":"A21N","manufacturer":"Airbus",
 *        "registration":"D-AIEG","registered_owner":"Lufthansa","url_photo":…,"url_photo_thumbnail":…}}}
 *   404 {"response":"unknown aircraft"}
 *   also: "registered_owner_country_iso_name":"DE", "registered_owner_country_name":"Germany",
 *         "registered_owner_operator_flag_code":"DLH" (the operator's ICAO code, or null)
 * Photo URLs end in airport-data's photo ID (…/aircraft/001726453.jpg); its page, which
 * names the photographer, is https://airport-data.com/aircraft/photo/001726453.
 *
 * GET https://api.adsbdb.com/v0/callsign/{callsign} →
 *   200 {"response":{"flightroute":{"callsign":…,"callsign_icao":…,"callsign_iata":…,
 *        "airline":{"name","icao","iata","country","country_iso","callsign"} or null,
 *        "origin":{airport}, "destination":{airport}, sometimes "midpoint":{airport}}}}
 *        airport: "name","municipality","country_name","country_iso_name","icao_code",
 *        "iata_code","latitude","longitude","elevation" (feet)
 *   404 {"response":"unknown callsign"}
 * GET https://api.adsbdb.com/v0/airline/{ICAO code} →
 *   200 {"response":[{"name","icao","iata","country","country_iso","callsign"}, …]}
 *   404 {"response":"unknown airline"}
 *
 * Browser-side; one lookup per address, callsign or airline per tab (cached here).
 */

import type { LatLon } from './modes/cpr';

export interface DbAircraft {
	/** As registered, with the dash: "D-AIEG". Military serials too ("15+10"). */
	registration: string;
	/** ICAO type designator (Doc 8643): "A21N". */
	icaoType: string;
	/** The manufacturer's model designation: "A321 271NXSL". */
	type: string;
	manufacturer: string;
	/** The registered owner: usually the airline, often a leasing company. */
	owner: string;
	/** The State whose register the aircraft is on (ISO 3166 code, name); null if not given. */
	country: { iso: string; name: string } | null;
	/** The operator's ICAO designator ("DLH"); null if not given (private, military, …). */
	operator: string | null;
	photo: DbPhoto | null;
}

export interface DbPhoto {
	/** Full size (~1200 × 800, ~200 kB), the photographer's credit printed along the bottom. */
	url: string;
	/** 150 × 100. */
	thumbnail: string | null;
	/** airport-data's page for the photo (photographer, date, place); null if the URL doesn't fit. */
	page: string | null;
}

export interface DbAirline {
	name: string;
	/** ICAO designator (Doc 8585): the first three letters of its callsigns, "DLH". */
	icao: string;
	/** IATA code, on tickets and departure boards: "LH". */
	iata: string | null;
	country: string;
	/** The telephony designator: what it's called on the radio, "LUFTHANSA". */
	radio: string | null;
}

export interface DbAirport extends LatLon {
	name: string;
	/** The city it serves. */
	city: string;
	country: string;
	/** ICAO location indicator (Doc 7910): "EDDB". */
	icao: string;
	/** IATA code: "BER". */
	iata: string | null;
	/** Above sea level, ft. */
	elevation: number | null;
}

export interface DbRoute {
	callsign: string;
	airline: DbAirline | null;
	origin: DbAirport;
	destination: DbAirport;
	/** A stop on the way, for the few routes that have one. */
	via: DbAirport | null;
}

const API = 'https://api.adsbdb.com/v0/';

type Json = Record<string, unknown>;
const isObject = (x: unknown): x is Json => typeof x === 'object' && x !== null;
const textOf = (o: Json, key: string) => (typeof o[key] === 'string' ? (o[key] as string) : '');
const numberOf = (o: Json, key: string) =>
	typeof o[key] === 'number' && Number.isFinite(o[key]) ? (o[key] as number) : null;

/** The `aircraft` object of an adsbdb response; null if there's none (unknown aircraft). */
export function parseAircraft(json: unknown): DbAircraft | null {
	const a = (json as { response?: { aircraft?: unknown } })?.response?.aircraft;
	if (!isObject(a)) return null;
	const text = (key: string) => textOf(a, key);
	const url = text('url_photo');
	const iso = text('registered_owner_country_iso_name');
	return {
		registration: text('registration'),
		icaoType: text('icao_type'),
		type: text('type'),
		manufacturer: text('manufacturer'),
		owner: text('registered_owner'),
		country: iso ? { iso, name: text('registered_owner_country_name') || iso } : null,
		operator: text('registered_owner_operator_flag_code') || null,
		photo: url
			? { url, thumbnail: text('url_photo_thumbnail') || null, page: photoPage(url) }
			: null
	};
}

function parseAirline(a: unknown): DbAirline | null {
	if (!isObject(a) || !textOf(a, 'icao')) return null;
	return {
		name: textOf(a, 'name'),
		icao: textOf(a, 'icao'),
		iata: textOf(a, 'iata') || null,
		country: textOf(a, 'country'),
		radio: textOf(a, 'callsign') || null
	};
}

function parseAirport(a: unknown): DbAirport | null {
	if (!isObject(a)) return null;
	const lat = numberOf(a, 'latitude');
	const lon = numberOf(a, 'longitude');
	if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
	return {
		lat,
		lon,
		name: textOf(a, 'name'),
		city: textOf(a, 'municipality'),
		country: textOf(a, 'country_name'),
		icao: textOf(a, 'icao_code'),
		iata: textOf(a, 'iata_code') || null,
		elevation: numberOf(a, 'elevation')
	};
}

/** The `flightroute` object of an adsbdb response; null if there's none or it lacks an end. */
export function parseRoute(json: unknown): DbRoute | null {
	const r = (json as { response?: { flightroute?: unknown } })?.response?.flightroute;
	if (!isObject(r)) return null;
	const origin = parseAirport(r.origin);
	const destination = parseAirport(r.destination);
	if (!origin || !destination) return null;
	return {
		callsign: textOf(r, 'callsign'),
		airline: parseAirline(r.airline),
		origin,
		destination,
		via: parseAirport(r.midpoint)
	};
}

/** The airline with exactly this ICAO designator from an `/airline` response; else null. */
export function parseAirlineList(json: unknown, icao: string): DbAirline | null {
	const list = (json as { response?: unknown })?.response;
	if (!Array.isArray(list)) return null;
	return list.map(parseAirline).find((a) => a?.icao === icao) ?? null;
}

/** airport-data's page for a photo, from the ID in the image's file name. */
export function photoPage(url: string): string | null {
	const id = /\/(\d+)\.jpe?g$/i.exec(url)?.[1];
	return id ? `https://airport-data.com/aircraft/photo/${id}` : null;
}

const cache = new Map<string, Promise<unknown>>();

/**
 * One request per path per tab: the same promise for the same path, so asking again (every
 * render) costs nothing. 404 (unknown) answers null, and stays cached. A failed request
 * (offline, server error) rejects and is forgotten, so the next look tries again.
 */
function lookup<T>(path: string, parse: (json: unknown) => T | null, get: typeof fetch) {
	let entry = cache.get(path) as Promise<T | null> | undefined;
	if (!entry) {
		entry = get(API + path).then(async (r) => {
			if (r.status === 404) return null;
			if (!r.ok) throw new Error(`adsbdb: HTTP ${r.status}`);
			return parse(await r.json());
		});
		entry.catch(() => cache.delete(path));
		cache.set(path, entry);
	}
	return entry;
}

/** The database entry for an address; null if adsbdb doesn't know it. */
export function lookupAircraft(
	icao: string,
	get: typeof fetch = fetch
): Promise<DbAircraft | null> {
	return lookup(`aircraft/${icao.toUpperCase()}`, parseAircraft, get);
}

/** The route flown under a callsign; null if adsbdb doesn't know it. */
export function lookupRoute(callsign: string, get: typeof fetch = fetch): Promise<DbRoute | null> {
	return lookup(`callsign/${encodeURIComponent(callsign.toUpperCase())}`, parseRoute, get);
}

/**
 * The airline whose designator a callsign starts with: "EJU64BR" → EJU. Only for callsigns
 * that look like an airline's: three letters, then a digit (the flight number). Private
 * flights use their registration instead ("DEABC"), and N-numbers start with N and a digit.
 */
export function airlineDesignator(callsign: string): string | null {
	const m = /^([A-Z]{3})\d[A-Z0-9]*$/.exec(callsign.toUpperCase());
	return m ? m[1] : null;
}

/** An airline by its ICAO designator; null if adsbdb doesn't know it. */
export function lookupAirline(icao: string, get: typeof fetch = fetch): Promise<DbAirline | null> {
	const key = icao.toUpperCase();
	return lookup(`airline/${key}`, (json) => parseAirlineList(json, key), get);
}

export interface DbFlight {
	route: DbRoute | null;
	/** From the route, else looked up by the callsign's first three letters. */
	airline: DbAirline | null;
}

/**
 * What adsbdb knows about the flight under this callsign: the route, and the airline (also
 * when the route is unknown, if the callsign starts with an airline's designator).
 */
export async function lookupFlight(callsign: string, get: typeof fetch = fetch): Promise<DbFlight> {
	const route = await lookupRoute(callsign, get);
	if (route?.airline) return { route, airline: route.airline };
	const designator = airlineDesignator(callsign);
	return { route, airline: designator ? await lookupAirline(designator, get) : null };
}

/** For tests: forget every lookup. */
export function clearLookups(): void {
	cache.clear();
}
