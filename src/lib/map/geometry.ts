/**
 * Small geometry shared by the map's GeoJSON builders: positions in GeoJSON's order, and
 * circles, arcs and ellipses drawn on the globe.
 */
import { destination } from '#lib/geo.ts';
import type { LatLon } from '#lib/modes/cpr.ts';

/** GeoJSON and MapLibre want longitude first: [lon, lat]. */
export const lngLat = (p: LatLon): [number, number] => [p.lon, p.lat];

/**
 * Points round `center` at the bearings `from` to `to` (degrees clockwise from true north,
 * `steps` equal steps, both ends included), each `km` away along the great circle: every
 * point the same distance from the centre on the globe, so on the flat map a circle comes
 * out very slightly egg-shaped. The full circle repeats its first point last, as a closed
 * ring must.
 */
export function circlePoints(
	center: LatLon,
	km: number,
	steps: number,
	from = 0,
	to = 360
): [number, number][] {
	return Array.from({ length: steps + 1 }, (_, i) =>
		lngLat(destination(center, from + ((to - from) * i) / steps, km))
	);
}

/**
 * A closed ellipse round `center`: semi-axes `major` and `minor` (km), the major one along
 * `bearing`. Spaced by the parametric angle θ (x = a cos θ, y = b sin θ), not by bearing:
 * equal bearings would leave the narrow ends, where the outline bends most, with the fewest
 * points. Each point is then one great-circle hop from the centre, at the bearing
 * atan2(b sin θ, a cos θ) off the major axis and the distance √((a cos θ)² + (b sin θ)²).
 */
export function ellipsePoints(
	center: LatLon,
	major: number,
	minor: number,
	bearing: number,
	steps: number
): [number, number][] {
	return Array.from({ length: steps + 1 }, (_, i) => {
		const theta = (2 * Math.PI * i) / steps;
		const [x, y] = [major * Math.cos(theta), minor * Math.sin(theta)];
		const off = (Math.atan2(y, x) * 180) / Math.PI;
		return lngLat(destination(center, bearing + off, Math.hypot(x, y)));
	});
}
