/**
 * What a tap or click on the map hit. The symbols are small and fingers are not, so it
 * looks in a box of HIT_PX either way round the point, and among the aircraft, radars and
 * the receiver takes the one whose symbol is nearest: an aircraft passing over the receiver
 * mustn't make the dot impossible to hit, nor the other way round. Only then a wind barb
 * (they sit under the aircraft's trails), then an airport's label (the base map's).
 */
import type { Map as MapLibreMap, MapGeoJSONFeature, PointLike } from 'maplibre-gl';
import { airportFrom, type Airport } from './airports.ts';
import type { BarbProperties } from './winds.ts';

/** Half the hit box's side, px. */
export const HIT_PX = 12;

/** The layers that react to a tap (and get a pointer cursor). */
export const PICKABLE = ['aircraft', 'radar-sites', 'receiver', 'winds', 'airports'] as const;

/** A wind barb and where on the map it is (its card follows it as the map moves). */
export interface PickedBarb {
	barb: BarbProperties;
	lon: number;
	lat: number;
}

export type Picked =
	| { kind: 'aircraft'; icao: string }
	| { kind: 'radar'; id: string }
	| { kind: 'receiver' }
	| ({ kind: 'barb' } & PickedBarb)
	| { kind: 'airport'; airport: Airport }
	/** The map itself: nothing there. */
	| null;

/** `shown`: the layers switched on that can be tapped (hidden ones are never hit). */
export function pick(
	map: MapLibreMap,
	point: { x: number; y: number },
	shown: { radars: boolean; winds: boolean }
): Picked {
	const box: [PointLike, PointLike] = [
		[point.x - HIT_PX, point.y - HIT_PX],
		[point.x + HIT_PX, point.y + HIT_PX]
	];
	const query = (id: (typeof PICKABLE)[number]) => map.queryRenderedFeatures(box, { layers: [id] });
	const away = (f: MapGeoJSONFeature) => {
		if (f.geometry.type !== 'Point') return Infinity;
		const at = map.project(f.geometry.coordinates as [number, number]);
		return Math.hypot(at.x - point.x, at.y - point.y);
	};
	const nearest = [
		...query('aircraft').map((f) => ({ f, kind: 'aircraft' as const })),
		...(shown.radars ? query('radar-sites') : []).map((f) => ({ f, kind: 'radar' as const })),
		...query('receiver').map((f) => ({ f, kind: 'receiver' as const }))
	].sort((a, b) => away(a.f) - away(b.f))[0];
	if (nearest?.kind === 'aircraft')
		return { kind: 'aircraft', icao: nearest.f.properties.icao as string };
	if (nearest?.kind === 'radar') return { kind: 'radar', id: nearest.f.properties.id as string };
	if (nearest) return { kind: 'receiver' };

	const barb = shown.winds ? query('winds')[0] : undefined;
	if (barb?.geometry.type === 'Point') {
		const [lon, lat] = barb.geometry.coordinates;
		return { kind: 'barb', barb: barb.properties as BarbProperties, lon, lat };
	}
	const label = query('airports')[0];
	const airport =
		label?.geometry.type === 'Point'
			? airportFrom(label.properties, {
					lon: label.geometry.coordinates[0],
					lat: label.geometry.coordinates[1]
				})
			: null;
	return airport ? { kind: 'airport', airport } : null;
}
