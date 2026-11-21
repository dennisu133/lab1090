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
import { circlePoints, lngLat } from './geometry.ts';

/** The horizon drawn: the airliners' cruise, most of what is heard here. */
export const HORIZON_FT = 35_000;

/** A colour for each band's outline: the altitude ramp (altitude.ts) at this altitude. */
export const BAND_COLOUR_FT = [5_000, 15_000, 25_000, 37_000] as const;

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
				return lngLat(
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
			coordinates: circlePoints(receiver, km, 180)
		}
	};
	const label: Feature<Point, { label?: string }> = {
		type: 'Feature',
		properties: { label: `Radio horizon, ${flightLevel(altitudeFt)}` },
		geometry: { type: 'Point', coordinates: lngLat(destination(receiver, 0, km)) }
	};
	return { type: 'FeatureCollection', features: [circle, label] };
}

/** A kept position as a dot, coloured by its altitude. */
function pointFeature(p: CoveragePoint, id: number): Feature<Point, PointProperties> {
	return {
		type: 'Feature',
		id,
		properties: { altitude: p.altitude, ground: false },
		geometry: { type: 'Point', coordinates: lngLat(p) }
	};
}

type PointProperties = { altitude: number; ground: false };

/**
 * The kept positions as MapLibre's GeoJSONSource.updateData takes them: tens of thousands,
 * published every few seconds, but each time only a few new at the end and a few old gone
 * from the start (Coverage keeps them in order). So only those go; anything else (the
 * antenna's height came in and made new points, a reset) sends everything again. Each point
 * gets a number as its id, counting on.
 */
export class PointUpdates {
	/** What the source holds, oldest first, and the id of the first. */
	#sent: CoveragePoint[] = [];
	#firstId = 0;
	#nextId = 0;

	next(points: CoveragePoint[]): {
		add: Feature<Point, PointProperties>[];
		remove: number[];
		removeAll?: true;
	} | null {
		const sent = this.#sent;
		const dropped = points.length ? sent.indexOf(points[0]) : sent.length;
		const kept = sent.length - Math.max(dropped, 0);
		// The points still there must be the same, in the same order (checked at the ends).
		const continues =
			dropped >= 0 && kept <= points.length && (kept === 0 || points[kept - 1] === sent.at(-1));
		this.#sent = points;
		if (!continues) {
			this.#firstId = this.#nextId;
			this.#nextId += points.length;
			return {
				removeAll: true,
				remove: [],
				add: points.map((p, i) => pointFeature(p, this.#firstId + i))
			};
		}
		const remove = Array.from({ length: dropped }, (_, i) => this.#firstId + i);
		this.#firstId += dropped;
		const add = points.slice(kept).map((p) => pointFeature(p, this.#nextId++));
		return add.length || remove.length ? { add, remove } : null;
	}

	/** The source was emptied. */
	reset(): void {
		this.#sent = [];
		this.#firstId = this.#nextId;
	}
}

/** The selected sector, out to `km`. */
export function sectorFeature(
	receiver: LatLon,
	from: number,
	km: number
): FeatureCollection<Polygon> {
	const arc = circlePoints(receiver, km, 10, from, from + SECTOR_DEG);
	const ring = [lngLat(receiver), ...arc, lngLat(receiver)];
	return {
		type: 'FeatureCollection',
		features: [
			{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }
		]
	};
}
