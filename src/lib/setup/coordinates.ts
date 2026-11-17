/**
 * Coordinates as people copy them, for /setup: typed, from a map app, or a map link.
 *
 *   52.5163, 13.3777                 decimal degrees, north and east positive
 *   52.5163° N, 13.3777° E           with hemispheres (S and W make it negative)
 *   52°30'58.7"N 13°22'39.7"E        degrees, minutes, seconds (Google Maps' place panel)
 *   geo:52.5163,13.3777              a geo URI (RFC 5870), what Android shares
 *   https://www.google.com/maps/place/…/@52.51,13.37,17z/data=…!3d52.5163!4d13.3777
 *   https://www.openstreetmap.org/?mlat=52.5163&mlon=13.3777#map=17/52.5163/13.3777
 *
 * Links may hold two positions: the place itself (Google's !3d…!4d…, OSM's mlat/mlon, a
 * q= or ll= parameter) and where the map was centred (Google's @lat,lon, OSM's #map=).
 * The place wins; a centre alone is accepted with a note: it's wherever the map was dragged.
 *
 * Every result says how fine its last digit is: "52.5, 13.4" is only good to ~11 km.
 */
import type { LatLon } from '#lib/modes/cpr.ts';

export interface ParsedCoordinates {
	position: LatLon;
	/** 'centre': from a link that only had the map's centre, not a marked place. */
	from: 'coordinates' | 'place' | 'centre';
	/** The size of the last digit given, in metres (north–south): how exact this can be. */
	resolutionM: number;
}

export type CoordinatesResult = ParsedCoordinates | { error: string };

/** One degree of latitude, in metres (it varies by under 1 % with latitude). */
export const METRES_PER_DEGREE = 111_320;

export function parseCoordinates(text: string): CoordinatesResult {
	const input = text.trim();
	if (!input) return { error: 'Enter coordinates or paste a map link.' };
	if (/^https?:\/\//i.test(input)) return fromLink(input);
	const geo = /^geo:([^?;]+)/i.exec(input);
	if (geo) return withFrom(fromText(geo[1]), 'place');
	return fromText(input);
}

function withFrom(result: CoordinatesResult, from: ParsedCoordinates['from']): CoordinatesResult {
	return 'error' in result ? result : { ...result, from };
}

function fromLink(link: string): CoordinatesResult {
	let url: URL;
	try {
		url = new URL(link);
	} catch {
		return { error: 'That link looks broken: copy it again.' };
	}
	const host = url.hostname.replace(/^www\./, '');
	if (host === 'maps.app.goo.gl' || host === 'goo.gl' || host === 'osm.org') {
		return {
			error:
				'Short links don’t contain the coordinates. Open the link, then copy the coordinates (or the long address from the browser’s address bar).'
		};
	}
	const path = decodeURIComponent(url.pathname).replace(/\+/g, ' ');

	// The place itself. Google: "!3d<lat>!4d<lon>" in the data part of the path.
	const google = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(path);
	if (google) return withFrom(fromText(`${google[1]},${google[2]}`), 'place');
	// OpenStreetMap's marker.
	const mlat = url.searchParams.get('mlat');
	const mlon = url.searchParams.get('mlon');
	if (mlat && mlon) return withFrom(fromText(`${mlat},${mlon}`), 'place');
	// q= (Google, Apple), query= (Google's api=1 links), ll= (Apple's dropped pin).
	for (const name of ['q', 'query', 'll']) {
		const value = url.searchParams.get(name);
		if (value) {
			const parsed = fromText(value);
			if (!('error' in parsed)) return { ...parsed, from: 'place' };
		}
	}
	// Google's /maps/place/<coordinates>/ and /maps/search/<coordinates>/.
	const segment = /\/(?:place|search)\/([^/]+)/.exec(path);
	if (segment) {
		const parsed = fromText(segment[1]);
		if (!('error' in parsed)) return { ...parsed, from: 'place' };
	}

	// Only where the map was: Google's "@lat,lon,17z", OSM's "#map=17/lat/lon".
	const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(path);
	if (at) return withFrom(fromText(`${at[1]},${at[2]}`), 'centre');
	const osm = /map=\d+(?:\.\d+)?\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/.exec(url.hash);
	if (osm) return withFrom(fromText(`${osm[1]},${osm[2]}`), 'centre');

	return {
		error:
			'No coordinates in that link. In the map app, mark the spot first (long-press or right-click), then share or copy it.'
	};
}

/** One coordinate: its value, the size of its last digit in degrees, its hemisphere letter. */
interface Part {
	value: number;
	resolution: number;
	hemisphere: 'N' | 'S' | 'E' | 'W' | null;
}

/** Decimal degrees with an optional sign, degree sign and hemisphere letter. */
const DECIMAL = /^([-+]?)(\d{1,3}(?:\.(\d+))?)\s*°?\s*([NSEW])?$/i;
/** Degrees, minutes and optionally seconds, with a hemisphere letter or a sign. */
const DMS =
	/^([-+]?)(\d{1,3})\s*°\s*(\d{1,2}(?:\.(\d+))?)\s*['′’]\s*(?:(\d{1,2}(?:\.(\d+))?)\s*(?:["″”]|'')\s*)?([NSEW])?$/i;

function fromText(text: string): CoordinatesResult {
	const parts = split(text.trim());
	if (!parts) {
		return { error: 'Expected two numbers, latitude then longitude, e.g. 52.5163, 13.3777.' };
	}
	const [first, second] = parts.map(part);
	if (!first || !second) {
		return { error: 'Couldn’t read these as coordinates. Example: 52.5163, 13.3777.' };
	}
	// With letters the order is clear (N/S is the latitude); without, latitude comes first.
	const swapped = first.hemisphere === 'E' || first.hemisphere === 'W';
	const [lat, lon] = swapped ? [second, first] : [first, second];
	const isLon = (p: Part) => p.hemisphere === 'E' || p.hemisphere === 'W';
	const isLat = (p: Part) => p.hemisphere === 'N' || p.hemisphere === 'S';
	if (isLon(lat) || isLat(lon)) {
		return { error: 'One coordinate needs N or S (latitude), the other E or W (longitude).' };
	}
	const signed = (p: Part) => (p.hemisphere === 'S' || p.hemisphere === 'W' ? -p.value : p.value);
	const position = { lat: signed(lat), lon: signed(lon) };
	if (Math.abs(position.lat) > 90) {
		return { error: `A latitude goes from −90 to 90; ${position.lat} is outside. Swapped?` };
	}
	if (Math.abs(position.lon) > 180) {
		return { error: `A longitude goes from −180 to 180; ${position.lon} is outside.` };
	}
	const resolution = Math.max(lat.resolution, lon.resolution);
	return { position, from: 'coordinates', resolutionM: resolution * METRES_PER_DEGREE };
}

/**
 * Split into latitude and longitude. A point is the decimal mark if there is one; then a
 * comma, semicolon or space separates. Without points, "52,5163; 13,3777" (a decimal comma)
 * needs the semicolon; "52,14" is two whole degrees.
 */
function split(text: string): [string, string] | null {
	const hemispheres = /^(.+?[NS])\s*,?\s*(.+[EW])$|^(.+?[EW])\s*,?\s*(.+[NS])$/i.exec(text);
	if (hemispheres) {
		return [hemispheres[1] ?? hemispheres[3], hemispheres[2] ?? hemispheres[4]].map((s) =>
			s.trim()
		) as [string, string];
	}
	let pieces: string[];
	if (text.includes(';')) {
		pieces = text.split(';').map((s) => s.trim().replace(/(\d),(\d)/g, '$1.$2'));
	} else if (text.includes(',')) {
		pieces = text.split(',').map((s) => s.trim());
	} else {
		pieces = text.split(/\s+/);
	}
	return pieces.length === 2 && pieces.every(Boolean) ? [pieces[0], pieces[1]] : null;
}

function part(text: string): Part | null {
	const decimal = DECIMAL.exec(text);
	if (decimal) {
		const [, sign, number, fraction, letter] = decimal;
		return signedPart(sign, Number(number), 10 ** -(fraction?.length ?? 0), letter);
	}
	const dms = DMS.exec(text);
	if (dms) {
		const [, sign, d, m, mFraction, s, sFraction, letter] = dms;
		if (Number(m) >= 60 || (s !== undefined && Number(s) >= 60)) return null;
		const value = Number(d) + Number(m) / 60 + Number(s ?? 0) / 3600;
		const resolution =
			s !== undefined
				? 10 ** -(sFraction?.length ?? 0) / 3600
				: 10 ** -(mFraction?.length ?? 0) / 60;
		return signedPart(sign, value, resolution, letter);
	}
	return null;
}

function signedPart(sign: string, value: number, resolution: number, letter?: string): Part | null {
	const hemisphere = (letter?.toUpperCase() ?? null) as Part['hemisphere'];
	if (hemisphere && sign) return null; // "-52.5 N": which one is meant?
	return { value: sign === '-' ? -value : value, resolution, hemisphere };
}
