/**
 * What an airframe database knows about an aircraft, looked up by its 24-bit address: type,
 * registration, owner and a photo. None of this is in the radio messages: ADS-B only says
 * the weight class (emitter category), and the registration only comes from Comm-B 2,1,
 * which hardly any radar asks for. So it's the one thing here that isn't decoded, and the
 * panel says so.
 *
 * Source: adsbdb (https://www.adsbdb.com, open source, MIT, by Jack Wills), aircraft data from
 * PlaneBase, photos from airport-data.com. Free, no key, CORS open, so the browser asks it
 * directly: the address and your IP go to adsbdb, and the photo comes from airport-data.
 * Planespotters.net has better photos but answered nothing from this app's page (and wants a
 * contact address from servers).
 *
 * GET https://api.adsbdb.com/v0/aircraft/{hex} →
 *   200 {"response":{"aircraft":{"type":"A321 271NXSL","icao_type":"A21N","manufacturer":"Airbus",
 *        "registration":"D-AIEG","registered_owner":"Lufthansa","url_photo":…,"url_photo_thumbnail":…}}}
 *   404 {"response":"unknown aircraft"}
 * Photo URLs end in airport-data's photo ID (…/aircraft/001726453.jpg); its page, which
 * names the photographer, is https://airport-data.com/aircraft/photo/001726453.
 *
 * Browser-side; one lookup per address per tab (cached here).
 */

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

const API = 'https://api.adsbdb.com/v0/aircraft/';

/** The `aircraft` object of an adsbdb response; null if there's none (unknown aircraft). */
export function parseAircraft(json: unknown): DbAircraft | null {
	const a = (json as { response?: { aircraft?: Record<string, unknown> } })?.response?.aircraft;
	if (!a || typeof a !== 'object') return null;
	const text = (key: string) => (typeof a[key] === 'string' ? (a[key] as string) : '');
	const url = text('url_photo');
	return {
		registration: text('registration'),
		icaoType: text('icao_type'),
		type: text('type'),
		manufacturer: text('manufacturer'),
		owner: text('registered_owner'),
		photo: url
			? { url, thumbnail: text('url_photo_thumbnail') || null, page: photoPage(url) }
			: null
	};
}

/** airport-data's page for a photo, from the ID in the image's file name. */
export function photoPage(url: string): string | null {
	const id = /\/(\d+)\.jpe?g$/i.exec(url)?.[1];
	return id ? `https://airport-data.com/aircraft/photo/${id}` : null;
}

const cache = new Map<string, Promise<DbAircraft | null>>();

/**
 * The database entry for an address; null if adsbdb doesn't know it. The same promise for
 * the same address, so asking again (every render) costs nothing. A failed request (offline,
 * server error) rejects and is forgotten, so the next look tries again.
 */
export function lookupAircraft(
	icao: string,
	get: typeof fetch = fetch
): Promise<DbAircraft | null> {
	const key = icao.toUpperCase();
	let entry = cache.get(key);
	if (!entry) {
		entry = get(API + key).then(async (r) => {
			if (r.status === 404) return null;
			if (!r.ok) throw new Error(`adsbdb: HTTP ${r.status}`);
			return parseAircraft(await r.json());
		});
		entry.catch(() => cache.delete(key));
		cache.set(key, entry);
	}
	return entry;
}

/** For tests: forget every lookup. */
export function clearLookups(): void {
	cache.clear();
}
