import { expect, test } from 'bun:test';
import { bearing, compass, distanceKm, parseLatLon } from './geo';

test('distance: one degree along the equator and along a meridian is ~111.2 km', () => {
	expect(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111.195, 2);
	expect(distanceKm({ lat: 10, lon: 20 }, { lat: 11, lon: 20 })).toBeCloseTo(111.195, 2);
	// across the date line: the short way round
	expect(distanceKm({ lat: 0, lon: 179.5 }, { lat: 0, lon: -179.5 })).toBeCloseTo(111.195, 2);
	// a degree of longitude shrinks with cos(latitude)
	expect(distanceKm({ lat: 60, lon: 0 }, { lat: 60, lon: 1 })).toBeCloseTo(55.6, 1);
});

test('bearing and compass', () => {
	const origin = { lat: 0, lon: 0 };
	expect(bearing(origin, { lat: 1, lon: 0 })).toBeCloseTo(0, 6);
	expect(bearing(origin, { lat: 0, lon: 1 })).toBeCloseTo(90, 6);
	expect(bearing(origin, { lat: -1, lon: 0 })).toBeCloseTo(180, 6);
	expect(bearing(origin, { lat: 0, lon: -1 })).toBeCloseTo(270, 6);
	expect(compass(0)).toBe('N');
	expect(compass(44)).toBe('NE');
	expect(compass(350)).toBe('N');
	expect(compass(225)).toBe('SW');
});

test('parseLatLon', () => {
	expect(parseLatLon('51.5,-0.1')).toEqual({ lat: 51.5, lon: -0.1 });
	expect(parseLatLon(' -33.9 , 151.2 ')).toEqual({ lat: -33.9, lon: 151.2 });
	expect(parseLatLon('')).toBeNull();
	expect(parseLatLon(undefined)).toBeNull();
	expect(() => parseLatLon('51.5')).toThrow();
	expect(() => parseLatLon('51.5;-0.1')).toThrow();
	expect(() => parseLatLon('91,0')).toThrow();
	expect(() => parseLatLon('0,181')).toThrow();
	expect(() => parseLatLon('a,b')).toThrow();
});
