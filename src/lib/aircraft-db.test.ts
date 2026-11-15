import { beforeEach, describe, expect, test } from 'bun:test';
import { clearLookups, lookupAircraft, parseAircraft, photoPage } from './aircraft-db';

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

describe('lookups', () => {
	beforeEach(clearLookups);

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
		expect(lookupAircraft('3C64A7', failing.get)).rejects.toThrow('HTTP 500');
		await Bun.sleep(0);
		const { get, asked } = answering(200, D_AIEG);
		expect((await lookupAircraft('3C64A7', get))?.owner).toBe('Lufthansa');
		expect(asked.length).toBe(1);
	});
});
