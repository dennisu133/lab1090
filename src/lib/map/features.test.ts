import { describe, expect, test } from 'bun:test';
import { distanceKm, KM_PER_NM } from '#lib/geo.ts';
import type { TrackedAircraft } from '#lib/tracker/tracker.ts';
import {
	aircraftFeatures,
	EXTRAPOLATE_MS,
	flightLevel,
	headFeatures,
	ringFeatures,
	SHOW_MS,
	shownPosition,
	trailFeatures
} from './features';

/** An aircraft at 52°N 14°E at t = 0, eastbound at 480 kt, FL350. */
function aircraft(changes: Partial<TrackedAircraft> = {}): TrackedAircraft {
	return {
		icao: 'ABC123',
		firstSeen: 0,
		lastSeen: 0,
		messages: 10,
		signal: null,
		adsb: true,
		callsign: { value: 'DLH4LW', t: 0, from: 'TC 4' },
		category: { value: { set: 'A', code: 3, name: 'Large (34–136 t)' }, t: 0, from: 'TC 4' },
		squawk: null,
		altitude: { value: 35_000, t: 0, from: 'TC 11' },
		gnssHeight: null,
		onGround: false,
		surface: null,
		ground: { value: { speed: 480, track: 90 }, t: 0, from: 'TC 19' },
		verticalRate: null,
		target: null,
		position: { lat: 52, lon: 14, t: 0, from: 'pair', surface: false },
		confirmed: true,
		rejected: 0,
		lastRejection: null,
		trail: [
			[
				{ lat: 52, lon: 13.9, altitude: 34_900, ground: false, t: -8000 },
				{ lat: 52, lon: 13.95, altitude: 34_950, ground: false, t: -4000 },
				{ lat: 52, lon: 14, altitude: 35_000, ground: false, t: 0 }
			]
		],
		commB: { intention: null, trackAndTurn: null, headingAndSpeed: null },
		...changes
	};
}

describe('dead reckoning', () => {
	test('moved along its track with its ground speed', () => {
		const shown = shownPosition(aircraft(), 3000)!;
		// 480 kt for 3 s: 0.4 NM = 0.74 km, due east.
		expect(shown.extrapolatedKm).toBeCloseTo((480 * KM_PER_NM * 3) / 3600, 9);
		expect(distanceKm({ lat: 52, lon: 14 }, shown)).toBeCloseTo(0.7408, 3);
		expect(shown.lon).toBeGreaterThan(14);
		expect(shown.age).toBe(3000);
	});

	test(`at most ${EXTRAPOLATE_MS / 1000} s ahead, hidden after ${SHOW_MS / 1000} s`, () => {
		const far = shownPosition(aircraft(), 25_000)!;
		expect(far.extrapolatedKm).toBeCloseTo((480 * KM_PER_NM * 15) / 3600, 9);
		expect(shownPosition(aircraft(), SHOW_MS + 1)).toBeNull();
	});

	test('not without a recent ground speed, not on the ground, never unconfirmed', () => {
		const old = aircraft({
			ground: { value: { speed: 480, track: 90 }, t: -11_000, from: 'TC 19' }
		});
		expect(shownPosition(old, 3000)!.extrapolatedKm).toBe(0);
		const parked = aircraft({ position: { lat: 52, lon: 14, t: 0, from: 'pair', surface: true } });
		expect(shownPosition(parked, 3000)).toMatchObject({ lat: 52, lon: 14, extrapolatedKm: 0 });
		expect(shownPosition(aircraft({ confirmed: false }), 0)).toBeNull();
	});
});

describe('features', () => {
	test('the symbol: label, size by weight class, pointing along the track', () => {
		const [f] = aircraftFeatures([aircraft()], 1000).features;
		expect(f.properties).toEqual({
			icao: 'ABC123',
			label: 'DLH4LW\nFL350',
			icon: 'jet',
			size: 0.8,
			track: 90,
			altitude: 35_000,
			ground: false,
			stale: false
		});
		expect(aircraftFeatures([aircraft()], 11_000).features[0].properties.stale).toBe(true);
	});

	test('flight levels: hundreds of feet, three digits', () => {
		expect(flightLevel(35_000)).toBe('FL350');
		expect(flightLevel(35_025)).toBe('FL350');
		expect(flightLevel(4_500)).toBe('FL045');
	});

	test('a trail: a line per pair of points, plus the piece up to the symbol', () => {
		const lines = trailFeatures([aircraft()], 2000).features;
		expect(lines.map((l) => l.properties.altitude)).toEqual([34_950, 35_000]);
		const [head] = headFeatures([aircraft()], 2000).features;
		expect(head.geometry.coordinates[0]).toEqual([14, 52]);
		expect(head.geometry.coordinates[1][0]).toBeGreaterThan(14);
		expect(headFeatures([aircraft()], 0).features).toEqual([]); // not moved: nothing to add
		expect(trailFeatures([aircraft()], SHOW_MS + 1).features).toEqual([]); // off the map
	});

	test('range rings: every point the same distance from the receiver', () => {
		const receiver = { lat: 51.8, lon: 14.3 };
		const { rings, labels } = ringFeatures(receiver, 'NM');
		expect(labels.features.map((l) => l.properties.label)).toEqual([
			'25 NM',
			'50 NM',
			'100 NM',
			'150 NM',
			'200 NM'
		]);
		for (const [lon, lat] of rings.features[2].geometry.coordinates) {
			expect(distanceKm(receiver, { lat, lon })).toBeCloseTo(185.2, 6);
		}
		expect(ringFeatures(receiver, 'km').labels.features[0].properties.label).toBe('50 km');
	});
});
