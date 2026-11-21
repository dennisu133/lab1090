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
			'The code pilots and air traffic control use, in flight plans, charts and weather reports; on the radio, airports go by name. The first letter is a region of the world, the second usually the country (ED: Germany, LK: Czechia), the last two the airport (ICAO Doc 7910).',
		tone: 'main',
		mono: true
	});
	if (a.elevation)
		fields.push({
			label: 'Elevation',
			value: `${n(a.elevation.feet)} ft (${n(a.elevation.metres)} m)`,
			title:
				"Height above sea level, as mapped: the official elevation (the highest point of the runways) can differ by a few metres. On the runway, an altimeter set to the local pressure (QNH) shows about the official one. Set to the standard 1013.25 hPa, as at flight levels, it's off by about 27 ft (8 m) for every hPa the local pressure differs.",
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
