import { expect, test } from 'bun:test';
import { parseCoordinates, type ParsedCoordinates } from './coordinates';

// Invented spots around Berlin's Brandenburg Gate, not anybody's antenna.
const ok = (text: string): ParsedCoordinates => {
	const result = parseCoordinates(text);
	if ('error' in result) throw new Error(`${text}: ${result.error}`);
	return result;
};
const position = (text: string) => ok(text).position;
const error = (text: string) => {
	const result = parseCoordinates(text);
	return 'error' in result ? result.error : null;
};

test('decimal degrees, signs and hemispheres', () => {
	expect(position('52.5163, 13.3777')).toEqual({ lat: 52.5163, lon: 13.3777 });
	expect(position('52.5163,13.3777')).toEqual({ lat: 52.5163, lon: 13.3777 });
	expect(position('52.5163 13.3777')).toEqual({ lat: 52.5163, lon: 13.3777 });
	expect(position('-33.8568, 151.2153')).toEqual({ lat: -33.8568, lon: 151.2153 });
	expect(position('52.5163° N, 13.3777° E')).toEqual({ lat: 52.5163, lon: 13.3777 });
	expect(position('33.8568S 151.2153E')).toEqual({ lat: -33.8568, lon: 151.2153 });
	expect(position('40.6892 N 74.0445 W')).toEqual({ lat: 40.6892, lon: -74.0445 });
	// Letters say which is which, whatever the order.
	expect(position('13.3777 E, 52.5163 N')).toEqual({ lat: 52.5163, lon: 13.3777 });
	// A decimal comma, with a semicolon between the two.
	expect(position('52,5163; 13,3777')).toEqual({ lat: 52.5163, lon: 13.3777 });
});

test('degrees, minutes, seconds', () => {
	const p = position(`52°30'58.7"N 13°22'39.7"E`);
	expect(p.lat).toBeCloseTo(52 + 30 / 60 + 58.7 / 3600, 9);
	expect(p.lon).toBeCloseTo(13 + 22 / 60 + 39.7 / 3600, 9);
	expect(position(`52° 30′ 58.7″ N, 13° 22′ 39.7″ E`).lat).toBeCloseTo(52.516306, 5);
	expect(position(`52°30.978'N 13°22.662'E`).lon).toBeCloseTo(13.3777, 4);
	expect(error(`52°75'00"N 13°22'39"E`)).not.toBeNull(); // 75 minutes
});

test('the last digit says how exact it can be', () => {
	expect(ok('52.5163, 13.3777').resolutionM).toBeCloseTo(11.1, 1);
	expect(ok('52.516, 13.37771').resolutionM).toBeCloseTo(111.3, 1); // the coarser one counts
	expect(ok('52.5, 13.4').resolutionM).toBeCloseTo(11_132, 0);
	expect(ok('52, 14').resolutionM).toBe(111_320); // two whole degrees, not 52.14
	expect(ok(`52°30'58.7"N 13°22'39.7"E`).resolutionM).toBeCloseTo(3.1, 1); // 0.1″
});

test('mistakes get an explanation', () => {
	expect(error('')).toContain('Enter');
	expect(error('52.5163')).toContain('two numbers');
	expect(error('52,5163, 13,3777')).toContain('two numbers'); // decimal commas need a ;
	expect(error('95.1, 13.3')).toContain('−90 to 90');
	expect(error('52.1, 190.5')).toContain('−180 to 180');
	expect(error('13.3 E, 14.2 W')).not.toBeNull();
	expect(error('-52.5 N, 13.4 E')).not.toBeNull(); // sign and letter
	expect(error('Pariser Platz 1')).not.toBeNull();
});

test('geo: URIs', () => {
	expect(ok('geo:52.5163,13.3777?z=17')).toMatchObject({
		position: { lat: 52.5163, lon: 13.3777 },
		from: 'place'
	});
});

test('Google Maps links: the place wins over the map centre', () => {
	const place =
		'https://www.google.com/maps/place/Brandenburger+Tor/@52.5160,13.3750,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d52.5162746!4d13.3777041!16s';
	expect(ok(place)).toMatchObject({
		position: { lat: 52.5162746, lon: 13.3777041 },
		from: 'place'
	});
	expect(ok('https://maps.google.com/?q=52.5163,13.3777')).toMatchObject({ from: 'place' });
	expect(ok('https://www.google.com/maps/search/?api=1&query=52.5163%2C13.3777').position).toEqual({
		lat: 52.5163,
		lon: 13.3777
	});
	const dms = `https://www.google.com/maps/place/52%C2%B030'58.7%22N+13%C2%B022'39.7%22E/@52.5163,13.3777,17z`;
	expect(ok(dms)).toMatchObject({ from: 'place' });
	expect(ok(dms).position.lat).toBeCloseTo(52.516306, 5);
	// Only the centre: accepted, but marked as such.
	expect(ok('https://www.google.com/maps/@52.5163,13.3777,17z')).toMatchObject({
		position: { lat: 52.5163, lon: 13.3777 },
		from: 'centre'
	});
});

test('OpenStreetMap and Apple links', () => {
	expect(
		ok('https://www.openstreetmap.org/?mlat=52.5163&mlon=13.3777#map=17/52.5100/13.3700')
	).toMatchObject({ position: { lat: 52.5163, lon: 13.3777 }, from: 'place' });
	expect(ok('https://www.openstreetmap.org/#map=17/52.51630/13.37770')).toMatchObject({
		position: { lat: 52.5163, lon: 13.3777 },
		from: 'centre'
	});
	expect(ok('https://maps.apple.com/?ll=52.5163,13.3777&q=Dropped%20Pin')).toMatchObject({
		position: { lat: 52.5163, lon: 13.3777 },
		from: 'place'
	});
});

test('links without coordinates', () => {
	expect(error('https://maps.app.goo.gl/AbCdEf123')).toContain('Short links');
	expect(error('https://www.google.com/maps/place/Brandenburger+Tor')).toContain('No coordinates');
	expect(error('https://')).toContain('broken');
});
