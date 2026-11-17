import { expect, test } from 'bun:test';
import { toPlace, type NominatimResult } from './geocode';

// Shaped like Nominatim's jsonv2 answers; the places are public landmarks.
const result = (
	place_rank: number,
	boundingbox: NominatimResult['boundingbox']
): NominatimResult => ({
	lat: '52.5162699',
	lon: '13.3777034',
	display_name: 'Brandenburger Tor, 1, Pariser Platz, Mitte, Berlin, 10117, Deutschland',
	place_rank,
	boundingbox
});

test('a building: a few dozen metres', () => {
	const place = toPlace(result(30, ['52.5161170', '52.5164328', '13.3775798', '13.3778251']));
	expect(place.matched).toBe('building');
	expect(place.position).toEqual({ lat: 52.5162699, lon: 13.3777034 });
	expect(place.uncertaintyM).toBeGreaterThan(15);
	expect(place.uncertaintyM).toBeLessThan(25);
	expect(place.bounds).toEqual([52.516117, 52.5164328, 13.3775798, 13.3778251]);
});

test('only the street: as long as the street', () => {
	// A street ~1.4 km long, east–west.
	const place = toPlace(result(26, ['52.5160', '52.5180', '13.3770', '13.3980']));
	expect(place.matched).toBe('street');
	expect(place.uncertaintyM).toBeGreaterThan(650);
	expect(place.uncertaintyM).toBeLessThan(750);
});

test('only an area', () => {
	expect(toPlace(result(16, ['52.33', '52.68', '13.08', '13.76'])).matched).toBe('area');
});
