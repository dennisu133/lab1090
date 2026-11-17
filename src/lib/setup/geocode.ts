/**
 * Address search for /setup: Nominatim, OpenStreetMap's own geocoder, run by the
 * OpenStreetMap Foundation. Called from the browser (like adsbdb): the address goes from the
 * user's browser to OSMF, never through our server. It allows requests from any origin
 * (CORS *), so no proxy is needed.
 *
 * Its usage policy (https://operations.osmfoundation.org/policies/nominatim/): at most one
 * request per second, no search-as-you-type, identify the application (the browser's
 * Referer does), credit OpenStreetMap. A setup page is the light, occasional use it allows.
 *
 * How exact is a match? Each result has a bounding box: a house is ~20–40 m across, a street
 * can be kilometres long, a town tens of kilometres. Half its diagonal is how far the point
 * we take (the box's reference point) can be from the antenna. If OSM doesn't know the
 * house number, Nominatim quietly answers with the street: the box shows it.
 */
import { distanceKm } from '#lib/geo.ts';
import type { LatLon } from '#lib/modes/cpr.ts';

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
/** The policy's limit: one request per second. */
export const MIN_INTERVAL_MS = 1000;
/** It usually answers within a second, but a first search can take 15 s. */
const TIMEOUT_MS = 30_000;

export interface Place {
	/** The full address as OSM has it, in the browser's language. */
	name: string;
	position: LatLon;
	/** What matched: a building or house number, only the street, or only an area. */
	matched: 'building' | 'street' | 'area';
	/** Half the bounding box's diagonal, metres: how far off the point can be. */
	uncertaintyM: number;
	/** The bounding box (south, north, west, east), to show the whole match on the map. */
	bounds: [south: number, north: number, west: number, east: number];
}

/** The fields of Nominatim's `format=jsonv2` answer we use. */
export interface NominatimResult {
	lat: string;
	lon: string;
	display_name: string;
	/** 30: houses, buildings, points of interest; 26–27: streets; lower: areas. */
	place_rank: number;
	boundingbox: [string, string, string, string];
}

export function toPlace(result: NominatimResult): Place {
	const [south, north, west, east] = result.boundingbox.map(Number) as Place['bounds'];
	const diagonalKm = distanceKm({ lat: south, lon: west }, { lat: north, lon: east });
	return {
		name: result.display_name,
		position: { lat: Number(result.lat), lon: Number(result.lon) },
		matched: result.place_rank >= 30 ? 'building' : result.place_rank >= 26 ? 'street' : 'area',
		uncertaintyM: (diagonalKm * 1000) / 2,
		bounds: [south, north, west, east]
	};
}

/** Up to five places for an address. Throws on network errors, timeouts, non-OK answers. */
export async function searchAddress(query: string): Promise<Place[]> {
	const url = new URL(ENDPOINT);
	url.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: '5' }).toString();
	const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
	if (!response.ok) throw new Error(`Nominatim answered ${response.status}`);
	return ((await response.json()) as NominatimResult[]).map(toPlace);
}
