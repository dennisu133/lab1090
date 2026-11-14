import { expect, test } from 'bun:test';
import { bearing, compass, destination, distanceKm, parseLatLon } from './geo';

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

test('destination: the inverse of distance and bearing', () => {
	const start = { lat: 51.8, lon: 14.3 };
	for (const [b, km] of [
		[0, 100],
		[90, 250],
		[225, 370.4],
		[300, 5]
	]) {
		const end = destination(start, b, km);
		expect(distanceKm(start, end)).toBeCloseTo(km, 6);
		expect(((bearing(start, end) - b + 540) % 360) - 180).toBeCloseTo(0, 6); // 359.999… is north too
	}
	// 60 NM due north is one degree of latitude (that's where the nautical mile comes from,
	// almost: 1,852 m is the mean, the sphere here gives 111.195 km / 60 = 1,853.25 m).
	expect(destination({ lat: 0, lon: 0 }, 0, 111.195).lat).toBeCloseTo(1, 4);
	// across the date line
	expect(destination({ lat: 0, lon: 179.9 }, 90, 22.239).lon).toBeCloseTo(-179.9, 4);
});
