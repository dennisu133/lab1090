/**
 * Airports, as the base map's tiles describe them: the labels on the map are OpenMapTiles'
 * `aerodrome_label` layer (from OpenStreetMap), and a tap on one opens its panel with what
 * the label's feature carries. Nothing here is decoded from the radio: it's map data, like
 * the roads.
 *
 * A feature's properties (OpenMapTiles schema, checked on a tile with EDDB):
 *   name, name_en, name_int, name:xx…   names; name is the local one
 *   iata, icao                          the codes (either may be missing)
 *   ele, ele_ft                         elevation, metres and feet, both rounded
 *   class                               international, public, regional, military, …
 *
 * The map only labels airports with an ICAO code (style.ts), so every tappable one has one.
 */
import type { LatLon } from '#lib/modes/cpr.ts';

export interface Airport extends LatLon {
	/** English name if the map has one, else the local one. */
	name: string;
	/** Four letters: EDDB. */
	icao: string;
	/** Three letters: BER. Not every airport has one. */
	iata: string | null;
	/** Above mean sea level; null if the map doesn't say. */
	elevation: { feet: number; metres: number } | null;
}

const FT = 0.3048;

const text = (p: Record<string, unknown>, key: string) => {
	const v = p[key];
	return typeof v === 'string' && v.trim() ? v.trim() : null;
};
const number = (p: Record<string, unknown>, key: string) => {
	const v = p[key];
	return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

/** A tapped label's feature → an Airport; null without an ICAO code. */
export function airportFrom(properties: Record<string, unknown>, at: LatLon): Airport | null {
	const icao = text(properties, 'icao');
	if (!icao) return null;
	const metres = number(properties, 'ele');
	const feet = number(properties, 'ele_ft');
	return {
		lat: at.lat,
		lon: at.lon,
		name:
			text(properties, 'name_en') ??
			text(properties, 'name_int') ??
			text(properties, 'name') ??
			icao,
		icao,
		iata: text(properties, 'iata'),
		elevation:
			feet !== null || metres !== null
				? {
						feet: feet ?? Math.round(metres! / FT),
						metres: metres ?? Math.round(feet! * FT)
					}
				: null
	};
}
