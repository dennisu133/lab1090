import { describe, expect, test } from 'bun:test';
import { distanceKm } from '#lib/geo.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { encodeCpr } from '#lib/modes/testing.ts';
import {
	MAX_RANGE_KM,
	MAX_STRIKES,
	Positions,
	rangeProblem,
	speedProblem,
	type Outcome
} from './positions';

const receiver: LatLon = { lat: 52, lon: 14 };

/** Where an aircraft flying from `start` at `kt` on `track` (degrees) is after `ms` (flat Earth: fine over a few km). */
function along(start: LatLon, track: number, kt: number, ms: number): LatLon {
	const km = (kt * 1.852 * ms) / 3_600_000;
	const rad = (track * Math.PI) / 180;
	return {
		lat: start.lat + (km * Math.cos(rad)) / 111.2,
		lon: start.lon + (km * Math.sin(rad)) / (111.2 * Math.cos((start.lat * Math.PI) / 180))
	};
}

/**
 * Messages every `every` ms (default 500), alternating even and odd like a transponder.
 * `surface`: surface position messages, taxiing at 15 kt (for the speed check).
 */
function fly(
	positions: Positions,
	from: number,
	count: number,
	where: (t: number) => LatLon,
	{ icao = 'ABC123', surface = false, every = 500 } = {}
): Outcome[] {
	return Array.from({ length: count }, (_, i) => {
		const t = from + i * every;
		const format = Math.round(t / every) % 2 ? 'odd' : 'even';
		const cpr = encodeCpr(where(t), format, surface ? 90 : 360);
		return positions.add(icao, cpr, t, surface ? 15 : 450, surface);
	});
}

describe('speed and range checks', () => {
	const from = { lat: 52, lon: 14, t: 0, from: 'pair' as const };
	/** `km` east of `from`, at time `t`. */
	const east = (km: number, t: number) => ({ ...along(from, 90, km / 1.852, 3_600_000), t });

	test('with a ground speed: that plus 200 kt, plus 2 km', () => {
		// 650 kt for 10 s is 3.34 km; with the slack, 5.34 km.
		expect(speedProblem(from, east(5.2, 10_000), 450)).toBeNull();
		expect(speedProblem(from, east(5.5, 10_000), 450)).toBe(
			'5.5 km from the last position in 10.0 s: more than 650 kt (its ground speed 450 + 200) would allow'
		);
	});

	test('without one: up to 1,000 kt', () => {
		// 1,000 kt for 10 s is 5.14 km; with the slack, 7.14 km.
		expect(speedProblem(from, east(7, 10_000), null)).toBeNull();
		expect(speedProblem(from, east(7.3, 10_000), null)).toBe(
			'7.3 km from the last position in 10.0 s: more than 1000 kt would allow'
		);
	});

	test('the same moment: only the slack', () => {
		expect(speedProblem(from, east(1.9, 0), 450)).toBeNull();
		expect(speedProblem(from, east(2.1, 0), 450)).not.toBeNull();
	});

	test('range: up to 500 km from the receiver, unchecked without a receiver position', () => {
		const near = { lat: receiver.lat + 4.4, lon: receiver.lon }; // 489 km north
		const far = { lat: receiver.lat + 4.6, lon: receiver.lon }; // 511 km
		expect(distanceKm(receiver, near)).toBeLessThan(MAX_RANGE_KM);
		expect(rangeProblem(near, receiver)).toBeNull();
		expect(rangeProblem(far, receiver)).toBe(
			'511 km from the receiver: beyond the radio horizon (500 km)'
		);
		expect(rangeProblem(far, null)).toBeNull();
	});
});

describe('Positions', () => {
	const start = { lat: 52.3, lon: 13.5 };
	const east = (t: number) => along(start, 90, 450, t);

	test('the first position needs a pair, and is confirmed by the next one', () => {
		const positions = new Positions(() => receiver);
		const [first] = fly(positions, 0, 1, east);
		expect(first.kind).toBe('waiting'); // one message: which zone? Not from the receiver's position.
		const [second] = fly(positions, 500, 1, east);
		expect(second.kind).toBe('fix');
		expect(positions.get('ABC123')!.confirmed).toBe(false);
		const [third] = fly(positions, 1000, 1, east);
		expect(third.kind).toBe('moved');
		expect(positions.get('ABC123')!.confirmed).toBe(true);
		const p = positions.get('ABC123')!.position!;
		expect(p.from).toBe('pair');
		expect(distanceKm(p, east(1000))).toBeLessThan(0.01); // CPR's ~5 m steps
	});

	test("without a partner: decoded relative to the aircraft's own last position", () => {
		const positions = new Positions(() => receiver);
		fly(positions, 0, 3, east);
		// 15 s later: the last messages from both grids are more than 10 s old, no pair.
		const t = 16_000;
		const outcome = positions.add('ABC123', encodeCpr(east(t), 'even'), t, 450);
		expect(outcome.kind).toBe('moved');
		const p = positions.get('ABC123')!.position!;
		expect(p.from).toBe('local');
		expect(distanceKm(p, east(t))).toBeLessThan(0.01);
	});

	test('beyond the radio horizon: never a fix', () => {
		const positions = new Positions(() => receiver);
		const far = { lat: 58, lon: 14 }; // 667 km north
		const outcomes = fly(positions, 0, 4, () => far);
		expect(outcomes.map((o) => o.kind)).toEqual(['waiting', 'rejected', 'rejected', 'rejected']);
		expect(positions.get('ABC123')).toEqual({ position: null, confirmed: false, rejected: 3 });
	});

	test(`a jump: rejected, until ${MAX_STRIKES} in a row say otherwise; then a fresh, unconfirmed fix`, () => {
		const positions = new Positions(() => receiver);
		fly(positions, 0, 4, east);
		// The same address, suddenly 150 km south: another aircraft with a wrongly set
		// address, or the first fix was bad. Either way, nothing can fly that fast.
		const south = { lat: 51, lon: 13.5 };
		const outcomes = fly(positions, 2000, 5, () => south);
		expect(outcomes.map((o) => o.kind)).toEqual([
			'rejected', // paired with the last message from the old place: nonsense
			'rejected',
			'restart',
			'moved',
			'moved'
		]);
		// A pair of messages from two places isn't anywhere near either: this one decodes to
		// the other side of the world. The speed check would catch it too.
		expect(outcomes[0].kind === 'rejected' && outcomes[0].reason).toBe(
			'8919 km from the receiver: beyond the radio horizon (500 km)'
		);
		expect(outcomes[1].kind === 'rejected' && outcomes[1].reason).toMatch(
			/^144\.\d km from the last position in 1\.0 s: more than 650 kt/
		);
		expect(distanceKm(positions.get('ABC123')!.position!, south)).toBeLessThan(0.01);
		expect(positions.get('ABC123')!.rejected).toBe(3);
	});

	test('one bad message among good ones: rejected, the track goes on', () => {
		const positions = new Positions(() => receiver);
		fly(positions, 0, 4, east);
		// A message that decodes 150 km off, alone: it spoils the pair before and after it.
		const t = 2000;
		const bad = positions.add('ABC123', encodeCpr({ lat: 51, lon: 13.5 }, 'even'), t, 450);
		const next = fly(positions, 2500, 4, east);
		expect(bad.kind).toBe('rejected');
		expect(next.map((o) => o.kind)).toEqual(['rejected', 'moved', 'moved', 'moved']);
		expect(positions.get('ABC123')!.confirmed).toBe(true);
	});

	test('after a minute without positions: a fresh fix, not a continuation', () => {
		const positions = new Positions(() => receiver);
		fly(positions, 0, 4, east);
		const later = fly(positions, 70_000, 3, east);
		expect(later.map((o) => o.kind)).toEqual(['waiting', 'fix', 'moved']);
	});

	test('aircraft are independent', () => {
		const positions = new Positions(() => receiver);
		fly(positions, 0, 3, east, { icao: 'AAAAAA' });
		const other = fly(positions, 0, 3, () => ({ lat: 51.5, lon: 15 }), { icao: 'BBBBBB' });
		expect(other.map((o) => o.kind)).toEqual(['waiting', 'fix', 'moved']);
		expect(positions.get('AAAAAA')!.confirmed).toBe(true);
	});
});

describe('surface positions', () => {
	const gate = { lat: 52.1, lon: 14.2 }; // an apron somewhere near the receiver
	const taxi = (t: number) => along(gate, 250, 15, t);

	test('the first one from a pair, with the receiver picking the quarter of the world', () => {
		const positions = new Positions(() => receiver);
		const outcomes = fly(positions, 0, 3, taxi, { surface: true });
		expect(outcomes.map((o) => o.kind)).toEqual(['waiting', 'fix', 'moved']);
		const p = positions.get('ABC123')!.position!;
		expect(p).toMatchObject({ from: 'pair', surface: true });
		expect(distanceKm(p, taxi(1000))).toBeLessThan(0.002); // surface CPR: ~1.25 m steps
	});

	test("a pair fits once in every 90°: decoded with a receiver in Sydney, it's in the wrong quarter", () => {
		const positions = new Positions(() => ({ lat: -33.9, lon: 151.2 }));
		const outcomes = fly(positions, 0, 2, taxi, { surface: true });
		expect(outcomes[1].kind === 'rejected' && outcomes[1].reason).toMatch(
			/km from the receiver: beyond the radio horizon/
		);
	});

	test('no receiver position and no earlier position of its own: no way to pick the quarter', () => {
		const positions = new Positions(() => null);
		const outcomes = fly(positions, 0, 3, taxi, { surface: true });
		expect(outcomes.map((o) => o.kind)).toEqual(['waiting', 'waiting', 'waiting']);
	});

	test('standing still, one message every 12 s (DO-260B: every 5 s, some missed): still pairs', () => {
		const positions = new Positions(() => receiver);
		const outcomes = fly(positions, 0, 3, () => gate, { surface: true, every: 12_000 });
		expect(outcomes.map((o) => o.kind)).toEqual(['waiting', 'fix', 'moved']);
	});

	test('landing: airborne, then surface, one track', () => {
		const positions = new Positions(() => null); // its own position is reference enough
		const runway = { lat: 52.1, lon: 14.2 };
		const approach = (t: number) => along(runway, 250, 140, t - 4000); // touches down at 4 s
		fly(positions, 0, 8, approach);
		expect(positions.get('ABC123')!.position!.surface).toBe(false);
		const rollout = fly(positions, 4000, 3, (t) => along(runway, 250, 100, t - 4000), {
			surface: true
		});
		// No surface partner yet: decoded relative to the last airborne position.
		expect(rollout.map((o) => o.kind)).toEqual(['moved', 'moved', 'moved']);
		const kinds = rollout.map((o) => o.kind === 'moved' && o.position.from);
		expect(kinds).toEqual(['local', 'pair', 'pair']);
		expect(positions.get('ABC123')!.position!.surface).toBe(true);
	});
});
