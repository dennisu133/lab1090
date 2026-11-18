/**
 * The antenna's coverage on the tracker's map, as GeoJSON (lib/coverage):
 * - one outline per altitude band (a polygon, filled faintly on the map): in each sector, out to the farthest position heard in
 *   that band (the sector's middle bearing, so the outline is a clean star, not a scribble);
 *   a sector with nothing in the band pulls the line back to the receiver.
 * - the radio horizon for an altitude: where that outline would be over a smooth Earth with
 *   nothing in the way.
 * - the kept positions as dots, coloured by altitude like the tracker.
 * - the selected sector as a wedge.
 */
import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { BANDS, SECTOR_DEG, type CoveragePoint, type Sector } from '#lib/coverage/coverage.ts';
import { radioHorizon } from '#lib/coverage/geometry.ts';
import { flightLevel } from '#lib/describe/format.ts';
import { destination } from '#lib/geo.ts';
import type { LatLon } from '#lib/modes/cpr.ts';

/** The horizon drawn: the airliners' cruise, most of what is heard here. */
export const HORIZON_FT = 35_000;

/** A colour for each band's outline: the altitude ramp (altitude.ts) at this altitude. */
export const BAND_COLOUR_FT = [5_000, 15_000, 25_000, 37_000] as const;

const lonLat = (p: LatLon): [number, number] => [p.lon, p.lat];

/**
 * Polygons, so the map can fill them faintly: an area reads as "heard within", where a bare
 * line coloured by altitude would look like one more trail. The bands nest (higher ones reach
 * further), so the fills add up towards the receiver.
 */
export function outlineFeatures(
	sectors: Sector[],
	receiver: LatLon
): FeatureCollection<Polygon, { band: number; altitude: number; name: string }> {
	return {
		type: 'FeatureCollection',
		features: BANDS.flatMap((band, i) => {
			if (!sectors.some((s) => s.farthest[i])) return [];
			const ring = sectors.map((s) => {
				const far = s.farthest[i];
				return lonLat(
					far ? destination(receiver, s.from + SECTOR_DEG / 2, far.distance) : receiver
				);
			});
			ring.push(ring[0]);
			return [
				{
					type: 'Feature' as const,
					properties: { band: i, altitude: BAND_COLOUR_FT[i], name: band.name },
					geometry: { type: 'Polygon' as const, coordinates: [ring] }
				}
			];
		})
	};
}

/** The radio horizon for aircraft at `altitudeFt`, as a circle with a label point due north. */
export function horizonFeatures(
	receiver: LatLon,
	altitudeFt: number,
	antennaKm: number
): FeatureCollection<LineString | Point, { label?: string }> {
	const km = radioHorizon(altitudeFt, antennaKm);
	const circle: Feature<LineString, { label?: string }> = {
		type: 'Feature',
		properties: {},
		geometry: {
			type: 'LineString',
			coordinates: Array.from({ length: 181 }, (_, i) => lonLat(destination(receiver, i * 2, km)))
		}
	};
	const label: Feature<Point, { label?: string }> = {
		type: 'Feature',
		properties: { label: `Radio horizon, ${flightLevel(altitudeFt)}` },
		geometry: { type: 'Point', coordinates: lonLat(destination(receiver, 0, km)) }
	};
	return { type: 'FeatureCollection', features: [circle, label] };
}

export function pointFeatures(
	points: CoveragePoint[]
): FeatureCollection<Point, { altitude: number; ground: false }> {
	return {
		type: 'FeatureCollection',
		features: points.map((p) => ({
			type: 'Feature',
			properties: { altitude: p.altitude, ground: false },
			geometry: { type: 'Point', coordinates: lonLat(p) }
		}))
	};
}

/** The selected sector, out to `km`. */
export function sectorFeature(
	receiver: LatLon,
	from: number,
	km: number
): FeatureCollection<Polygon> {
	const arc = Array.from({ length: 11 }, (_, i) =>
		lonLat(destination(receiver, from + (i * SECTOR_DEG) / 10, km))
	);
	const ring = [lonLat(receiver), ...arc, lonLat(receiver)];
	return {
		type: 'FeatureCollection',
		features: [
			{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }
		]
	};
}
