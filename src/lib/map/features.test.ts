import { describe, expect, test } from 'bun:test';
import { bearing, distanceKm, KM_PER_NM } from '#lib/geo.ts';
import type { TrackedAircraft } from '#lib/tracker/tracker.ts';
import {
	aircraftFeatures,
	EXTRAPOLATE_MS,
	flightLevel,
	headFeatures,
	PREDICT_S,
	PREDICT_SELECTED_S,
	predictionFeatures,
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
		registration: null,
		category: { value: { set: 'A', code: 3, name: 'Large (34–136 t)' }, t: 0, from: 'TC 4' },
		squawk: null,
		altitude: { value: 35_000, t: 0, from: 'TC 11' },
		gnssHeight: null,
		onGround: false,
		surface: null,
		ground: { value: { speed: 480, track: 90 }, t: 0, from: 'TC 19' },
		turnRate: null,
		air: null,
		verticalRate: null,
		operational: null,
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

	test('in a turn: along the arc, the symbol turning with it', () => {
		// 3°/s right for 10 s: 30° on. Moving the chord's length along the mean track (105°).
		const a = aircraft({ turnRate: { value: 3, t: 0, from: 'TC 19' } });
		const shown = shownPosition(a, 10_000)!;
		expect(shown.track).toBeCloseTo(120, 0);
		expect(bearing({ lat: 52, lon: 14 }, shown)).toBeCloseTo(105, 0);
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
			track: expect.closeTo(90, 1), // + the meridians' convergence, 0.003° in 1 s
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

	test(`the predicted path: ${PREDICT_S} s in 5 s pieces, ${PREDICT_SELECTED_S} s with minute marks when selected`, () => {
		const climbing = aircraft({
			verticalRate: { value: { rate: 1200, source: 'baro' }, t: 0, from: 'TC 19' }
		});
		const { lines, minutes } = predictionFeatures([climbing], 2000, null);
		expect(lines.features.length).toBe(PREDICT_S / 5);
		expect(minutes.features).toEqual([]);
		// It starts at the symbol, and each piece has the altitude at its end: +100 ft per 5 s.
		const [first] = lines.features;
		const symbol = shownPosition(climbing, 2000)!;
		expect(first.geometry.coordinates[0]).toEqual([symbol.lon, symbol.lat]);
		expect(first.properties.altitude).toBeCloseTo(35_000 + (1200 * 7) / 60, 6);

		const selected = predictionFeatures([climbing], 2000, 'ABC123');
		expect(selected.lines.features.length).toBe(PREDICT_SELECTED_S / 5);
		expect(selected.minutes.features.map((f) => f.properties.label)).toEqual([
			'1 min',
			'2 min',
			'3 min'
		]);
		// 1 min ahead of the symbol: 8 NM at 480 kt.
		const [lon, lat] = selected.minutes.features[0].geometry.coordinates;
		expect(distanceKm(symbol, { lat, lon })).toBeCloseTo(8 * KM_PER_NM, 3);
	});

	test('no prediction once faded, or without a ground velocity', () => {
		expect(predictionFeatures([aircraft()], 11_000, null).lines.features).toEqual([]);
		expect(predictionFeatures([aircraft({ ground: null })], 0, null).lines.features).toEqual([]);
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
