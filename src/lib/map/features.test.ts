import { describe, expect, test } from 'bun:test';
import { bearing, distanceKm } from '#lib/geo.ts';
import { KM_PER_NM } from '#lib/units.ts';
import { resolutionAdvisory } from '#lib/modes/acas.ts';
import { advisoryField } from '#lib/tracker/alert-scenario.ts';
import type { TrackedAircraft } from '#lib/tracker/tracker.ts';
import {
	alertLinkFeatures,
	PULSE_MS,
	PULSES,
	aircraftFeatures,
	headFeatures,
	PREDICT_S,
	PREDICT_SELECTED_S,
	predictionFeatures,
	ringFeatures,
	routeFeatures,
	uncertaintyFeatures,
	trailFeatures
} from './features';
import { flightLevel } from '#lib/describe/format.ts';
import { EXTRAPOLATE_MS, SHOW_MS, shownPosition } from '#lib/tracker/shown.ts';

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
		emergency: null,
		advisory: null,
		ident: null,
		altitude: { value: 35_000, t: 0, from: 'TC 11' },
		gnssHeight: null,
		onGround: false,
		surface: null,
		ground: { value: { speed: 480, track: 90 }, t: 0, from: 'TC 19' },
		turnRate: null,
		air: null,
		verticalRate: null,
		operational: null,
		nacP: null,
		positionCode: null,
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
			stale: false,
			tier: '',
			badge: '',
			pulse: -1,
			dim: false,
			sort: 2
		});
		expect(aircraftFeatures([aircraft()], 11_000).features[0].properties.stale).toBe(true);
	});

	test('alerts: ring tier, badge, a pulse when it starts, IDENT blinking', () => {
		const streak = <T>(value: T, since: number, from = 'TC 28') => ({
			value,
			t: 1000,
			from,
			since,
			count: 2
		});
		const mayday = aircraft({ squawk: streak('7700', 0), emergency: streak(1, 0) });
		const at = (now: number, animate = true) =>
			aircraftFeatures([mayday], now, animate).features[0].properties;
		expect(at(1000)).toMatchObject({ tier: 'emergency', badge: '7700', sort: 0 });
		expect(at(750).pulse).toBeCloseTo(0.5); // half way through the first of the pulses
		expect(at(PULSES * PULSE_MS).pulse).toBe(-1);
		expect(at(750, false).pulse).toBe(-1);
		const ident = aircraft({ ident: streak(true as const, 0, 'TC 11') });
		const blink = (now: number) => aircraftFeatures([ident], now).features[0].properties;
		expect(blink(1000)).toMatchObject({ badge: 'IDENT', dim: false, tier: '' });
		expect(blink(1500).dim).toBe(true);
	});

	test('an ACAS advisory: one line between the two aircraft, with their vertical distance', () => {
		const ra = (threat: string, sense: 'up' | 'down') => ({
			value: {
				...resolutionAdvisory(advisoryField(0xe2, { sense, threat }))
			},
			t: 1000,
			from: 'TC 28',
			since: 0,
			count: 2
		});
		const up = aircraft({ icao: 'AAAAAA', advisory: ra('BBBBBB', 'up') });
		const down = aircraft({
			icao: 'BBBBBB',
			altitude: { value: 34_000, t: 0, from: 'TC 11' },
			position: { lat: 52.05, lon: 14, t: 0, from: 'pair', surface: false },
			advisory: ra('AAAAAA', 'down')
		});
		const { features } = alertLinkFeatures([up, down], 1000);
		expect(features).toHaveLength(1);
		expect(features[0].properties).toEqual({ tier: 'caution', label: '1,000 ft' });
		expect(aircraftFeatures([up], 1000).features[0].properties.badge).toBe('RA ↑');
		// The threat out of sight: no line.
		expect(alertLinkFeatures([up], 1000).features).toEqual([]);
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

	test('uncertainty circles: metres to pixels at zoom 0, at the latitude', () => {
		const a = aircraft({
			nacP: { value: 9, t: 0, from: 'TC 29' },
			positionCode: { value: { tc: 11, nicB: 1 }, t: 0, from: 'TC 11' },
			operational: {
				value: { version: 2, hrd: 'true', sil: 3, silSupplement: 0, nicA: 1, nicC: null },
				t: 0,
				from: 'TC 31'
			}
		});
		const [f] = uncertaintyFeatures([a], 0).features;
		// The world is 512 px wide at zoom 0; at 52°N a pixel covers cos 52° of the equator's.
		const metresPerPixel = (40_075_016.686 / 512) * Math.cos((52 * Math.PI) / 180);
		expect(f.properties.accuracy).toBeCloseTo(30 / metresPerPixel, 9); // NACp 9: 30 m
		expect(f.properties.containment).toBeCloseTo(75 / metresPerPixel, 9); // NIC 9
		expect(f.properties.unknown).toBe(false);
		// At zoom 15 (×2^15) a pixel is 1.47 m: 30 m are 20 px, the symbol's size. The 75 m
		// ring reaches that at zoom 13.7 or so: zoomed in on a town.
		expect(f.properties.accuracy! * 2 ** 15).toBeCloseTo(20.4, 1);
	});

	test('uncertainty unknown (NACp 0, TC 18): the warning ring; nothing said yet: nothing', () => {
		const blind = aircraft({
			nacP: { value: 0, t: 0, from: 'TC 31' },
			positionCode: { value: { tc: 18, nicB: 0 }, t: 0, from: 'TC 18' }
		});
		const [f] = uncertaintyFeatures([blind], 0).features;
		expect(f.properties).toEqual({
			icao: 'ABC123',
			altitude: 35_000,
			ground: false,
			unknown: true
		});
		expect(uncertaintyFeatures([aircraft()], 0).features).toEqual([]);
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

describe('route', () => {
	const airport = (icao: string, iata: string | null, lat: number, lon: number) => ({
		icao,
		iata,
		lat,
		lon,
		name: icao,
		city: icao,
		country: '',
		elevation: null
	});

	test('nothing to draw without a route', () => {
		const { line, airports } = routeFeatures(null);
		expect(line.features).toEqual([]);
		expect(airports.features).toEqual([]);
	});

	test('the great circle in pieces of at most 25 km, through the stop; airports by IATA code', () => {
		const origin = airport('LEVC', 'VLC', 39.4893, -0.48163);
		const via = airport('EDDF', null, 50.03333, 8.57056);
		const dest = airport('EDDB', 'BER', 52.35139, 13.49389);
		const { line, airports } = routeFeatures({
			callsign: 'TST1',
			airline: null,
			origin,
			destination: dest,
			via
		});
		const c = line.features[0].geometry.coordinates;
		const at =
			(p: { lat: number; lon: number }) =>
			([lon, lat]: number[]) =>
				Math.abs(lon - p.lon) < 1e-9 && Math.abs(lat - p.lat) < 1e-9;
		expect(at(origin)(c[0])).toBe(true);
		expect(at(dest)(c.at(-1)!)).toBe(true);
		expect(c.some(at(via))).toBe(true);
		for (let i = 1; i < c.length; i++) {
			const km = distanceKm({ lon: c[i - 1][0], lat: c[i - 1][1] }, { lon: c[i][0], lat: c[i][1] });
			expect(km).toBeLessThanOrEqual(25);
		}
		expect(airports.features.map((f) => f.properties.label)).toEqual(['VLC', 'EDDF', 'BER']);
	});

	test('across the date line, the longitudes go on instead of jumping back', () => {
		// Tokyo Haneda to San Francisco.
		const { line } = routeFeatures({
			callsign: 'TST2',
			airline: null,
			origin: airport('RJTT', 'HND', 35.5523, 139.78),
			destination: airport('KSFO', 'SFO', 37.619, -122.375),
			via: null
		});
		const lons = line.features[0].geometry.coordinates.map(([lon]) => lon);
		for (let i = 1; i < lons.length; i++) expect(Math.abs(lons[i] - lons[i - 1])).toBeLessThan(5);
		expect(lons.at(-1)).toBeCloseTo(-122.375 + 360, 6);
	});
});
