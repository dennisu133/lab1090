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

/**
 * Where you get to from `start`, going `km` along a great circle with the initial
 * direction `bearingDeg` (clockwise from true north). The "direct problem" on a sphere:
 * the angular distance d = km / R, then the spherical law of cosines for the latitude and
 * the sine rule for the longitude.
 */
export function destination(start: LatLon, bearingDeg: number, km: number): LatLon {
	const d = km / EARTH_RADIUS_KM;
	const theta = rad(bearingDeg);
	const phi1 = rad(start.lat);
	const phi2 = Math.asin(
		Math.sin(phi1) * Math.cos(d) + Math.cos(phi1) * Math.sin(d) * Math.cos(theta)
	);
	const dLon = Math.atan2(
		Math.sin(theta) * Math.sin(d) * Math.cos(phi1),
		Math.cos(d) - Math.sin(phi1) * Math.sin(phi2)
	);
	const lon = start.lon + (dLon * 180) / Math.PI;
	return { lat: (phi2 * 180) / Math.PI, lon: ((lon + 540) % 360) - 180 };
}

/** 8-point compass direction: N, NE, E, … */
export function compass(degrees: number): string {
	return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(degrees / 45) % 8];
}

/** "lat,lon" in decimal degrees, e.g. "51.5,-0.1". Throws if missing or malformed. */
export function parseLatLon(value: string | undefined): LatLon {
	if (!value?.trim()) {
		throw new Error('required: the antenna\'s position as "latitude,longitude", e.g. "51.5,-0.1"');
	}
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

/**
 * The point a fraction `f` (0–1) of the way from a to b along the great circle: the
 * "intermediate point" formula, spherical linear interpolation of the two unit vectors.
 */
export function intermediate(a: LatLon, b: LatLon, f: number): LatLon {
	const d = distanceKm(a, b) / EARTH_RADIUS_KM;
	if (d === 0) return { lat: a.lat, lon: a.lon };
	const wa = Math.sin((1 - f) * d) / Math.sin(d);
	const wb = Math.sin(f * d) / Math.sin(d);
	const [p1, l1, p2, l2] = [rad(a.lat), rad(a.lon), rad(b.lat), rad(b.lon)];
	const x = wa * Math.cos(p1) * Math.cos(l1) + wb * Math.cos(p2) * Math.cos(l2);
	const y = wa * Math.cos(p1) * Math.sin(l1) + wb * Math.cos(p2) * Math.sin(l2);
	const z = wa * Math.sin(p1) + wb * Math.sin(p2);
	return {
		lat: (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI,
		lon: (Math.atan2(y, x) * 180) / Math.PI
	};
}
