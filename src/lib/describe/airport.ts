/**
 * The airport panel's text (routes/AirportPanel.svelte): the codes, the elevation and where
 * it lies from the receiver. Map data (lib/map/airports.ts), not decoded, so the section says
 * where it's from, like "Airframe (adsbdb)".
 */
import { bearing, compass, distanceKm } from '#lib/geo.ts';
import type { Airport } from '#lib/map/airports.ts';
import type { Unit } from '#lib/map/features.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { distanceText, type PanelField, type Section } from './aircraft.ts';

const n = (x: number) => Math.round(x).toLocaleString('en');
const deg = (x: number) => `${String(Math.round(x) % 360).padStart(3, '0')}°`;

/** The headline: the code people know from tickets (BER), else the ICAO one. */
export const airportCode = (a: Airport) => a.iata ?? a.icao;

export function airportSections(a: Airport, receiver: LatLon, unit: Unit): Section[] {
	const fields: PanelField[] = [];
	if (a.iata)
		fields.push({
			label: 'IATA',
			value: a.iata,
			title:
				"The airlines' code: on tickets, baggage tags and departure boards. Pilots and controllers use the ICAO code instead.",
			tone: 'main',
			mono: true
		});
	fields.push({
		label: 'ICAO',
		value: a.icao,
		title:
			'The ICAO location indicator: in flight plans, on air traffic control frequencies and in weather reports (METAR). The first letter is a region of the world, the second usually the country (ED: Germany, LK: Czechia), the last two the airport.',
		tone: 'main',
		mono: true
	});
	if (a.elevation)
		fields.push({
			label: 'Elevation',
			value: `${n(a.elevation.feet)} ft (${n(a.elevation.metres)} m)`,
			title:
				"Above mean sea level, as mapped: the official elevation (the landing area's highest point) can differ by a few metres. On the runway an altimeter set to the local QNH shows the official one. Set to 1013.25 hPa, as for flight levels, it's off by about 27 ft (8 m) for every hPa the QNH differs.",
			tone: 'main'
		});
	const b = bearing(receiver, a);
	fields.push({
		label: 'From receiver',
		value: `${distanceText(distanceKm(receiver, a), unit)} ${compass(b)} (${deg(b)})`,
		tone: 'main'
	});
	return [{ title: 'Airport (OpenStreetMap)', fields }];
}
