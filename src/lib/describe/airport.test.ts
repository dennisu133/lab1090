import { describe, expect, test } from 'bun:test';
import type { Airport } from '#lib/map/airports.ts';
import { airportCode, airportSections } from './airport.ts';

const RECEIVER = { lat: 52, lon: 14 };
// One degree of latitude north of the receiver: 60 NM, 111 km.
const NORTH: Airport = {
	lat: 53,
	lon: 14,
	name: 'Test Airport',
	icao: 'EDXX',
	iata: 'XXX',
	elevation: { feet: 154, metres: 47 }
};

const values = (a: Airport, unit: 'NM' | 'km' = 'NM') =>
	Object.fromEntries(airportSections(a, RECEIVER, unit)[0].fields.map((f) => [f.label, f.value]));

describe('airport panel', () => {
	test('headline: the IATA code if there is one, else the ICAO code', () => {
		expect(airportCode(NORTH)).toBe('XXX');
		expect(airportCode({ ...NORTH, iata: null })).toBe('EDXX');
	});

	test('codes, elevation in ft and m, where it lies from the receiver', () => {
		expect(values(NORTH)).toEqual({
			IATA: 'XXX',
			ICAO: 'EDXX',
			Elevation: '154 ft (47 m)',
			'From receiver': '60 NM N (000°)'
		});
		expect(values(NORTH, 'km')['From receiver']).toBe('111 km N (000°)');
	});

	test('leaves out what the map doesn’t know', () => {
		expect(Object.keys(values({ ...NORTH, iata: null, elevation: null }))).toEqual([
			'ICAO',
			'From receiver'
		]);
	});

	test('one section, named after its source: map data, not decoded', () => {
		expect(airportSections(NORTH, RECEIVER, 'NM').map((s) => s.title)).toEqual(['Airport']);
		expect(airportSections(NORTH, RECEIVER, 'NM')[0].source).toBe('OpenStreetMap');
	});
});
