/**
 * The airport panel's text (routes/AirportPanel.svelte): the codes, the elevation and where
 * it lies from the receiver. Map data (lib/map/airports.ts), not decoded, so the section says
 * where it's from (`source`), like the airframe's "adsbdb".
 */
import { bearing, compass, distanceKm } from '#lib/geo.ts';
import type { Airport } from '#lib/map/airports.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import type { PanelField, Section } from './aircraft.ts';
import { directionText, distanceText, n, type Unit } from './format.ts';

/** The headline: the code people know from tickets (BER), else the ICAO one. */
export const airportCode = (a: Airport) => a.iata ?? a.icao;

export function airportSections(a: Airport, receiver: LatLon, unit: Unit): Section[] {
	const fields: PanelField[] = [];
	if (a.iata)
		fields.push({
			label: 'IATA',
			value: a.iata,
			title: "The airlines' code: on tickets, baggage tags and departure boards.",
			tone: 'main',
			mono: true
		});
	fields.push({
		label: 'ICAO',
		value: a.icao,
		title:
			'The ICAO location indicator: in flight plans, NOTAMs, charts and weather reports (METAR); on the radio, airports go by name. The first letter is a region of the world, the second usually the country (ED: Germany, LK: Czechia), the last two the airport.',
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
		value: `${distanceText(distanceKm(receiver, a), unit)} ${compass(b)} (${directionText(b)})`,
		tone: 'main'
	});
	return [{ title: 'Airport', source: 'OpenStreetMap', fields }];
}
