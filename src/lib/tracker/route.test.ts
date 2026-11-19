import { describe, expect, test } from 'bun:test';
import type { DbAirport, DbRoute } from '#lib/aircraft-db.ts';
import { bearing, destination, distanceKm, intermediate } from '#lib/geo.ts';
import { KM_PER_NM } from '#lib/units.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { checkRoute, MIN_DETOUR_KM, RouteJudge } from './route';
import type { TrackedAircraft } from './tracker';
import type { TrailPoint } from './trail';

// Invented routes between real airports (adsbdb's route data may not be copied: aircraft-db.ts).
const airport = (icao: string, lat: number, lon: number): DbAirport => ({
	icao,
	lat,
	lon,
	name: icao,
	city: icao,
	country: '',
	iata: null,
	elevation: null
});
const VALENCIA = airport('LEVC', 39.4893, -0.48163);
const BERLIN = airport('EDDB', 52.35139, 13.49389);
const GATWICK = airport('EGKK', 51.1481, -0.19028);
const LANZAROTE = airport('GCRR', 28.9455, -13.6052);
const FRANKFURT = airport('EDDF', 50.03333, 8.57056);
const HAMBURG = airport('EDDH', 53.6304, 9.98823);

const route = (origin: DbAirport, dest: DbAirport, via: DbAirport | null = null): DbRoute => ({
	callsign: 'TST123',
	airline: null,
	origin,
	destination: dest,
	via
});

/** A trail ending at `end` at t = 0: one point every 4 s, `turn` °/s, at `kt`. */
function flown(end: LatLon, track: number, seconds: number, kt = 450, turn = 0): TrailPoint[] {
	const step = 4;
	const km = (kt * KM_PER_NM * step) / 3600;
	const points: TrailPoint[] = [];
	// Backwards from the end: the reverse track, turning the other way.
	let p = end;
	let t = track;
	for (let s = 0; s <= seconds; s += step) {
		points.unshift({
			lat: p.lat,
			lon: p.lon,
			altitude: 30_000,
			ground: false,
			velocity: null,
			t: -s * 1000
		});
		p = destination(p, t + 180, km);
		t -= turn * step;
	}
	return points;
}

function aircraft(trail: TrailPoint[]): TrackedAircraft {
	const last = trail.at(-1)!;
	return {
		icao: 'ABC123',
		trail: [trail],
		position: { lat: last.lat, lon: last.lon, t: 0, from: 'pair', surface: false }
	} as unknown as TrackedAircraft;
}

describe('route check', () => {
	const toBerlin = route(VALENCIA, BERLIN);

	test('half way, on the great circle, going the right way: fits', () => {
		const here = intermediate(VALENCIA, BERLIN, 0.5);
		const along = bearing(here, BERLIN);
		const c = checkRoute(aircraft(flown(here, along, 300)), toBerlin)!;
		expect(c.verdict).toBe('fits');
		expect(c.detourKm).toBeLessThan(1);
		expect(c.fromKm + c.toGoKm).toBeCloseTo(c.directKm, 0);
	});

	test('the same, the other way round: backwards', () => {
		const here = intermediate(VALENCIA, BERLIN, 0.5);
		const c = checkRoute(aircraft(flown(here, bearing(here, VALENCIA), 300)), toBerlin)!;
		expect(c.verdict).toBe('backwards');
	});

	test('south-east of Berlin, vectored north for the approach: fits, not pointing at BER', () => {
		// EJU64BR in the screenshot: 37 km from BER, track 017°, BER at 315°.
		const here = { lat: 52.1104, lon: 13.8841 };
		expect(bearing(here, BERLIN)).toBeCloseTo(315, -1);
		const c = checkRoute(aircraft(flown(here, 17, 180, 280)), toBerlin)!;
		expect(c.verdict).toBe('fits');
		expect(c.toGoKm).toBeCloseTo(37, -1);
	});

	test('just after take-off, flying away from the destination: fits (it is leaving the origin)', () => {
		// Took off away from Valencia (about 225° from Berlin), turning round comes later.
		const away = bearing(BERLIN, VALENCIA) + 180;
		const here = destination(BERLIN, away, 25);
		const c = checkRoute(aircraft(flown(here, away, 150, 220)), route(BERLIN, VALENCIA))!;
		expect(c.verdict).toBe('fits');
		expect(c.progress!.closer).toBeLessThan(0);
	});

	test('a holding pattern near the destination says nothing about the direction', () => {
		// Circling at 1.5°/s (a 4-minute circle), 4 min of it.
		const here = destination(BERLIN, 200, 40);
		const c = checkRoute(aircraft(flown(here, 0, 240, 220, 1.5)), toBerlin)!;
		expect(c.verdict).toBe('unknown');
	});

	test('a minute of trail is too little', () => {
		const here = intermediate(VALENCIA, BERLIN, 0.5);
		const c = checkRoute(aircraft(flown(here, bearing(here, BERLIN), 60)), toBerlin)!;
		expect(c.verdict).toBe('unknown');
		expect(c.progress).toBeNull();
	});

	test('London to Lanzarote over Berlin: off route, whatever the direction', () => {
		const here = { lat: 52.3, lon: 13.9 };
		const c = checkRoute(aircraft(flown(here, 200, 300)), route(GATWICK, LANZAROTE))!;
		expect(c.verdict).toBe('off-route');
		expect(c.detourKm).toBeGreaterThan(c.maxDetourKm);
	});

	test('a detour round closed airspace: up to a quarter of the way, or 100 km on short flights', () => {
		// Frankfurt–Berlin is 429 km: 107 km allowed. 60 km off the middle is a ~17 km detour.
		const fra = route(FRANKFURT, BERLIN);
		const middle = intermediate(FRANKFURT, BERLIN, 0.5);
		const off = destination(middle, bearing(middle, BERLIN) + 90, 60);
		const c = checkRoute(aircraft(flown(off, bearing(off, BERLIN), 300)), fra)!;
		expect(c.maxDetourKm).toBeCloseTo(0.25 * c.directKm, 6);
		expect(c.verdict).toBe('fits');
		// Hamburg–Berlin is 255 km: a quarter would be 64 km, the minimum is more.
		const ham = intermediate(HAMBURG, BERLIN, 0.5);
		const short = checkRoute(
			aircraft(flown(ham, bearing(ham, BERLIN), 300)),
			route(HAMBURG, BERLIN)
		);
		expect(short!.maxDetourKm).toBe(MIN_DETOUR_KM);
		// 200 km off: a 160 km detour.
		const far = destination(middle, bearing(middle, BERLIN) + 90, 200);
		expect(checkRoute(aircraft(flown(far, bearing(far, BERLIN), 300)), fra)!.verdict).toBe(
			'off-route'
		);
	});

	test('with a stop on the way, the leg it is on', () => {
		const here = intermediate(FRANKFURT, BERLIN, 0.5);
		const c = checkRoute(
			aircraft(flown(here, bearing(here, BERLIN), 300)),
			route(VALENCIA, BERLIN, FRANKFURT)
		)!;
		expect(c.leg.from.icao).toBe('EDDF');
		expect(c.leg.to.icao).toBe('EDDB');
		expect(c.verdict).toBe('fits');
	});

	test('no position, no check', () => {
		expect(checkRoute({ trail: [], position: null } as unknown as TrackedAircraft, toBerlin)).toBe(
			null
		);
	});

	test('the great circle passes through the intermediate points', () => {
		const mid = intermediate(VALENCIA, BERLIN, 0.25);
		expect(distanceKm(VALENCIA, mid)).toBeCloseTo(distanceKm(VALENCIA, BERLIN) / 4, 3);
		expect(distanceKm(mid, BERLIN)).toBeCloseTo((3 * distanceKm(VALENCIA, BERLIN)) / 4, 3);
	});
});

describe('route judge', () => {
	const toBerlin = route(VALENCIA, BERLIN);
	const half = intermediate(VALENCIA, BERLIN, 0.5);

	test('a route that fits is shown', () => {
		const judged = new RouteJudge().judge(
			aircraft(flown(half, bearing(half, BERLIN), 300)),
			toBerlin
		);
		expect(judged.shown).toBe(true);
	});

	test("one that doesn't fit is dismissed, and stays dismissed when the verdict wavers", () => {
		const judge = new RouteJudge();
		const backwards = aircraft(flown(half, bearing(half, VALENCIA), 300));
		expect(judge.judge(backwards, toBerlin)).toMatchObject({
			shown: false,
			check: { verdict: 'backwards' }
		});
		// A minute later it turns: "can't tell" on its own, but the route stays dismissed.
		const turning = aircraft(flown(half, 0, 300, 450, 1.5));
		expect(checkRoute(turning, toBerlin)!.verdict).toBe('unknown');
		expect(judge.judge(turning, toBerlin)).toMatchObject({
			shown: false,
			check: { verdict: 'backwards' }
		});
		// Another aircraft under the same callsign is judged afresh.
		expect(judge.judge({ ...turning, icao: 'DEF456' }, toBerlin).shown).toBe(true);
	});
});
