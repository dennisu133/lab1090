/** Distances and directions on the globe. Shared by server and browser. */
import type { LatLon } from './modes/cpr';

/** Mean Earth radius. */
const EARTH_RADIUS_KM = 6371.0088;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance (haversine), in km. */
export function distanceKm(a: LatLon, b: LatLon): number {
	const dLat = rad(b.lat - a.lat);
	const dLon = rad(b.lon - a.lon);
	const h =
		Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
	return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Initial direction from a to b, in degrees clockwise from true north (0–360). */
export function bearing(a: LatLon, b: LatLon): number {
	const dLon = rad(b.lon - a.lon);
	const y = Math.sin(dLon) * Math.cos(rad(b.lat));
	const x =
		Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
		Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLon);
	return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** 8-point compass direction: N, NE, E, … */
export function compass(degrees: number): string {
	return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(degrees / 45) % 8];
}

/** "lat,lon" in decimal degrees, e.g. "51.5,-0.1". null if empty; throws if malformed. */
export function parseLatLon(value: string | undefined): LatLon | null {
	if (!value?.trim()) return null;
	const parts = value.split(',').map((p) => Number(p.trim()));
	const [lat, lon] = parts;
	if (parts.length !== 2 || !Number.isFinite(lat) || !Number.isFinite(lon)) {
		throw new Error('expected "latitude,longitude" in decimal degrees, e.g. "51.5,-0.1"');
	}
	if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
		throw new Error('latitude must be within ±90 and longitude within ±180');
	}
	return { lat, lon };
}
