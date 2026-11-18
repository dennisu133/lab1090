import { describe, expect, test } from 'bun:test';
import {
	airlineDesignator,
	lookupAircraft,
	lookupFlight,
	parseAircraft,
	parseAirlineList,
	parseRoute,
	photoPage
} from './aircraft-db';

// adsbdb's answer for 3C64A7 (Lufthansa's D-AIEG, in the capture), 2026-11-15.
const D_AIEG = {
	response: {
		aircraft: {
			type: 'A321 271NXSL',
			icao_type: 'A21N',
			manufacturer: 'Airbus',
			mode_s: '3C64A7',
			registration: 'D-AIEG',
			registered_owner_country_iso_name: 'DE',
			registered_owner_country_name: 'Germany',
			registered_owner_operator_flag_code: 'DLH',
			registered_owner: 'Lufthansa',
			url_photo: 'https://image.airport-data.com/aircraft/001726453.jpg',
			url_photo_thumbnail:
				'https://airport-data.com/images/aircraft/thumbnails/001/726/001726453.jpg'
		}
	}
};

describe('adsbdb responses', () => {
	test('an aircraft with a photo; the photo page from the ID in the file name', () => {
		expect(parseAircraft(D_AIEG)).toEqual({
			registration: 'D-AIEG',
			icaoType: 'A21N',
			type: 'A321 271NXSL',
			manufacturer: 'Airbus',
			owner: 'Lufthansa',
			country: { iso: 'DE', name: 'Germany' },
			operator: 'DLH',
			photo: {
				url: 'https://image.airport-data.com/aircraft/001726453.jpg',
				thumbnail: 'https://airport-data.com/images/aircraft/thumbnails/001/726/001726453.jpg',
				page: 'https://airport-data.com/aircraft/photo/001726453'
			}
		});
	});

	test('no photo (null URLs), unknown aircraft, rubbish', () => {
		const noPhoto = {
			response: {
				aircraft: { ...D_AIEG.response.aircraft, url_photo: null, url_photo_thumbnail: null }
			}
		};
		expect(parseAircraft(noPhoto)?.photo).toBeNull();
		expect(parseAircraft({ response: 'unknown aircraft' })).toBeNull();
		expect(parseAircraft(null)).toBeNull();
		expect(photoPage('https://example.com/photo.png')).toBeNull();
	});
});

// An invented route in adsbdb's shape: its route data may not be copied (aircraft-db.ts).
const AIRLINE = {
	name: 'Test Air',
	icao: 'TST',
	iata: 'TT',
	country: 'Germany',
	country_iso: 'DE',
	callsign: 'TESTER'
};
const airport = (icao: string, iata: string, city: string, lat: number, lon: number) => ({
	country_iso_name: 'DE',
	country_name: 'Germany',
	elevation: 100,
	iata_code: iata,
	icao_code: icao,
	latitude: lat,
	longitude: lon,
	municipality: city,
	name: `${city} Airport`
});
const TST123 = {
	response: {
		flightroute: {
			callsign: 'TST123',
			callsign_icao: 'TST123',
			callsign_iata: 'TT123',
			airline: AIRLINE,
			origin: airport('EDDF', 'FRA', 'Frankfurt', 50.03333, 8.57056),
			destination: airport('EDDB', 'BER', 'Berlin', 52.35139, 13.49389)
		}
	}
};

describe('adsbdb routes and airlines', () => {
	test('a route: airline, both ends, no stop on the way', () => {
		const r = parseRoute(TST123)!;
		expect(r.airline).toEqual({
			name: 'Test Air',
			icao: 'TST',
			iata: 'TT',
			country: 'Germany',
			radio: 'TESTER'
		});
		expect(r.origin).toEqual({
			lat: 50.03333,
			lon: 8.57056,
			name: 'Frankfurt Airport',
			city: 'Frankfurt',
			country: 'Germany',
			icao: 'EDDF',
			iata: 'FRA',
			elevation: 100
		});
		expect(r.destination.iata).toBe('BER');
		expect(r.via).toBeNull();
	});

	test('a stop on the way (midpoint); no airline; an end without coordinates is no route', () => {
		const flightroute = TST123.response.flightroute;
		const via = { ...flightroute, midpoint: airport('EDDH', 'HAM', 'Hamburg', 53.6304, 9.98823) };
		expect(parseRoute({ response: { flightroute: via } })?.via?.icao).toBe('EDDH');
		const noAirline = { ...flightroute, airline: null };
		expect(parseRoute({ response: { flightroute: noAirline } })?.airline).toBeNull();
		const broken = { ...flightroute, destination: { ...flightroute.destination, latitude: null } };
		expect(parseRoute({ response: { flightroute: broken } })).toBeNull();
		expect(parseRoute({ response: 'unknown callsign' })).toBeNull();
	});

	test('airlines: the one with exactly that designator', () => {
		const list = { response: [{ ...AIRLINE, icao: 'TSX' }, AIRLINE] };
		expect(parseAirlineList(list, 'TST')?.name).toBe('Test Air');
		expect(parseAirlineList(list, 'TSY')).toBeNull();
		expect(parseAirlineList({ response: 'unknown airline' }, 'TST')).toBeNull();
	});

	test("an airline's designator only from callsigns that look like an airline's", () => {
		expect(airlineDesignator('EJU64BR')).toBe('EJU');
		expect(airlineDesignator('DLH400')).toBe('DLH');
		expect(airlineDesignator('DEABC')).toBeNull(); // a German registration
		expect(airlineDesignator('N123AB')).toBeNull(); // an American one
		expect(airlineDesignator('GAF')).toBeNull();
	});
});

// The cache lasts as long as the module (a tab; here the whole file): each test asks for
// addresses and callsigns of its own.
describe('lookups', () => {
	const answering = (status: number, body: unknown) => {
		const asked: string[] = [];
		const get = (async (url: string) => {
			asked.push(url);
			return new Response(JSON.stringify(body), { status });
		}) as unknown as typeof fetch;
		return { get, asked };
	};

	test('one request per address, however often it is asked', async () => {
		const { get, asked } = answering(200, D_AIEG);
		const first = lookupAircraft('3c64a7', get);
		expect(lookupAircraft('3C64A7', get)).toBe(first);
		expect((await first)?.registration).toBe('D-AIEG');
		expect(asked).toEqual(['https://api.adsbdb.com/v0/aircraft/3C64A7']);
	});

	test('404: unknown, and stays unknown', async () => {
		const { get, asked } = answering(404, { response: 'unknown aircraft' });
		expect(await lookupAircraft('4400F8', get)).toBeNull();
		expect(await lookupAircraft('4400F8', get)).toBeNull();
		expect(asked.length).toBe(1);
	});

	test('a failed request is forgotten, so the next look tries again', async () => {
		const failing = answering(500, {});
		expect(lookupAircraft('3C6586', failing.get)).rejects.toThrow('HTTP 500');
		await Bun.sleep(0);
		const { get, asked } = answering(200, D_AIEG);
		expect((await lookupAircraft('3C6586', get))?.owner).toBe('Lufthansa');
		expect(asked.length).toBe(1);
	});

	test('a flight: the route, and its airline', async () => {
		const { get, asked } = answering(200, TST123);
		const f = await lookupFlight('tst123', get);
		expect(f.route?.destination.icao).toBe('EDDB');
		expect(f.airline?.radio).toBe('TESTER');
		expect(asked).toEqual(['https://api.adsbdb.com/v0/callsign/TST123']);
	});

	test('an unknown route: the airline by the designator', async () => {
		const asked: string[] = [];
		const get = (async (url: string) => {
			asked.push(url);
			return url.includes('/callsign/')
				? new Response(JSON.stringify({ response: 'unknown callsign' }), { status: 404 })
				: new Response(JSON.stringify({ response: [AIRLINE] }), { status: 200 });
		}) as unknown as typeof fetch;
		const f = await lookupFlight('TST9AB', get);
		expect(f.route).toBeNull();
		expect(f.airline?.name).toBe('Test Air');
		expect(asked).toEqual([
			'https://api.adsbdb.com/v0/callsign/TST9AB',
			'https://api.adsbdb.com/v0/airline/TST'
		]);
		// A private flight's registration: no airline to ask for.
		expect((await lookupFlight('DEABC', get)).airline).toBeNull();
	});
});
