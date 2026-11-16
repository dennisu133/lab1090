import { describe, expect, test } from 'bun:test';
import { airportFrom } from './airports.ts';

// EDDB's label feature as an OpenFreeMap tile (z8) has it, most of the names left out.
const EDDB = {
	name: 'Flughafen Berlin Brandenburg',
	name_en: 'Berlin Brandenburg Airport "Willy Brandt"',
	name_int: 'Berlin Brandenburg Airport Willy Brandt',
	iata: 'BER',
	icao: 'EDDB',
	ele: 47,
	ele_ft: 154,
	class: 'international'
};
const AT = { lat: 52.366, lon: 13.503 };

describe('airportFrom', () => {
	test('reads the codes, the English name and both elevations', () => {
		expect(airportFrom(EDDB, AT)).toEqual({
			...AT,
			name: 'Berlin Brandenburg Airport "Willy Brandt"',
			icao: 'EDDB',
			iata: 'BER',
			elevation: { feet: 154, metres: 47 }
		});
	});

	test('falls back to the international, then the local name', () => {
		expect(airportFrom({ ...EDDB, name_en: undefined }, AT)?.name).toBe(
			'Berlin Brandenburg Airport Willy Brandt'
		);
		expect(airportFrom({ ...EDDB, name_en: undefined, name_int: undefined }, AT)?.name).toBe(
			'Flughafen Berlin Brandenburg'
		);
	});

	test('no IATA code, elevation in one unit only', () => {
		const a = airportFrom({ icao: 'EDAZ', name: 'Schönhagen', ele: 40 }, AT)!;
		expect(a.iata).toBeNull();
		expect(a.elevation).toEqual({ feet: 131, metres: 40 });
		expect(airportFrom({ icao: 'EDAZ', ele_ft: 131 }, AT)!.elevation).toEqual({
			feet: 131,
			metres: 40
		});
		expect(airportFrom({ icao: 'EDAZ' }, AT)!.elevation).toBeNull();
	});

	test('no ICAO code, no airport (the map only labels those with one)', () => {
		expect(airportFrom({ name: 'Somewhere', iata: 'XYZ' }, AT)).toBeNull();
		expect(airportFrom({ icao: ' ' }, AT)).toBeNull();
	});
});
