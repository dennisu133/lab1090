import { describe, expect, test } from 'bun:test';
import { destination, distanceKm } from '#lib/geo.ts';
import { AddressFilter } from '#lib/modes/address-filter.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { downlinkFormat } from '#lib/modes/frame.ts';
import { BeastParser, type BeastFrame } from '#lib/beast/parser.ts';
import { capture } from '#lib/server/beast/testing.ts';
import { Tracker } from '#lib/tracker/tracker.ts';
import { injectJamming, JAMMED_KM, JAMMER, REACQUIRE_S } from './jamming-scenario';
import type { Judgement, Navigation } from './navigation';
import { observe } from './observe';
import {
	CELL_KM,
	FORGET_MS,
	GnssWatch,
	HOLD,
	MIN_AIRCRAFT,
	PLACE_MS,
	WINDOW_MS,
	type Observation
} from './watch';

const receiver = { lat: 52, lon: 14 };

const judgements: Record<Navigation, Judgement> = {
	good: { state: 'good', tc: 11, nic: 8, rc: 185.2, nacP: 9 },
	degraded: { state: 'degraded', tc: 18, nic: 0, rc: null, nacP: 0 },
	none: { state: 'none', tc: 0, nic: null, rc: null, nacP: 0 }
};

/** An aircraft flying east from the receiver at 450 kt (0.23 km/s), a message every 0.5 s. */
function flight(
	icao: string,
	states: Navigation[],
	start = 0,
	from: LatLon = receiver
): Observation[] {
	return states.map((state, i) => ({
		icao,
		t: start + i * 500,
		judgement: judgements[state],
		position: state === 'none' ? null : destination(from, 90, i * 0.1157),
		altitude: 36000,
		callsign: `TST${icao.slice(-2)}`
	}));
}

const times = (state: Navigation, n: number): Navigation[] => Array(n).fill(state);

function watched(...observations: Observation[][]): GnssWatch {
	const watch = new GnssWatch(receiver);
	for (const o of observations.flat().sort((a, b) => a.t - b.t)) watch.add(o);
	return watch;
}

describe('changes', () => {
	test(`a state counts after ${HOLD} messages in a row: two odd ones change nothing`, () => {
		const watch = watched(
			flight('AAAA01', [...times('good', 10), 'degraded', 'degraded', ...times('good', 10)])
		);
		expect(watch.changes()).toEqual([]);
		expect(watch.aircraft()[0]).toMatchObject({ state: 'good', arrived: 'good', wasGood: true });
		// A stray message doesn't stand for the state either.
		const stray = watched(flight('AAAA01', [...times('degraded', 10), 'good']));
		expect(stray.aircraft()[0]).toMatchObject({ state: 'degraded', judgement: { nic: 0 } });
	});

	test('lost: from its first message, placed at the last good position; regained at the first good one', () => {
		const o = flight('AAAA02', [
			...times('good', 10),
			...times('degraded', 20),
			...times('good', 10)
		]);
		const [lost, regained] = watched(o).changes();
		expect(lost).toMatchObject({
			kind: 'lost',
			other: 'degraded',
			t: o[10].t,
			at: o[9].position,
			gap: 500
		});
		expect(regained).toMatchObject({
			kind: 'regained',
			other: 'degraded',
			t: o[30].t,
			at: o[30].position
		});
	});

	test('without positions in between (TC 0); regained waits for its first good position', () => {
		const o = flight('AAAA03', [...times('good', 10), ...times('none', 20), ...times('good', 10)]);
		// The first two good messages after the gap gave no position (the tracker needs a pair).
		o[30].position = o[31].position = null;
		const [lost, regained] = watched(o).changes();
		expect(lost).toMatchObject({ other: 'none', at: o[9].position });
		expect(regained).toMatchObject({ other: 'none', t: o[30].t, at: o[32].position, atT: o[32].t });
	});

	test(`no place if the nearest position is more than ${PLACE_MS / 1000} s from the change`, () => {
		const before = flight('AAAA04', times('good', 10));
		const after = flight('AAAA04', times('degraded', 10), before.at(-1)!.t + PLACE_MS + 1000);
		const [lost] = watched(before, after).changes();
		expect(lost).toMatchObject({ kind: 'lost', at: null, gap: PLACE_MS + 1000 });
	});

	test('arriving degraded is no change: a degraded stretch marked as arrived', () => {
		const watch = watched(flight('AAAA05', times('degraded', 60)));
		expect(watch.changes()).toEqual([]);
		expect(watch.aircraft()[0]).toMatchObject({ arrived: 'degraded', wasGood: false });
		const [stretch] = watch.stretches();
		expect(stretch.arrived).toBe(true);
		// About every 10 s, and the last one at the latest position: 30 s of flight.
		expect(stretch.points.map((p) => p.t)).toEqual([0, 9500, 19_000, 28_500, 29_500]);
	});

	test(`an aircraft back after ${FORGET_MS / 60_000} min arrives anew`, () => {
		const first = flight('AAAA06', times('good', 10));
		const again = flight('AAAA06', times('degraded', 10), FORGET_MS + 10_000);
		const watch = watched(first, again);
		expect(watch.changes()).toEqual([]);
		expect(watch.aircraft()[0]).toMatchObject({ arrived: 'degraded', wasGood: false });
	});
});

describe('versions', () => {
	test('the changes and stretches count up when they change, and only then', () => {
		const watch = new GnssWatch(receiver);
		const version = () => [watch.changesVersion, watch.stretchesVersion];
		for (const o of flight('AAAA07', times('good', 10))) watch.add(o);
		expect(version()).toEqual([0, 0]);
		const lost = flight('AAAA07', times('degraded', 10), 5000);
		for (const o of lost) watch.add(o);
		const [changes, stretches] = version();
		expect(changes).toBeGreaterThan(0);
		expect(stretches).toBeGreaterThan(0);
		watch.prune(lost.at(-1)!.t);
		expect(version()).toEqual([changes, stretches]);
		watch.prune(lost.at(-1)!.t + WINDOW_MS + 1); // both forgotten
		expect(watch.changesVersion).toBeGreaterThan(changes);
		expect(watch.stretchesVersion).toBeGreaterThan(stretches);
	});
});

describe('the grid', () => {
	test(`cells count each aircraft once, and show from ${MIN_AIRCRAFT} aircraft on`, () => {
		const good = ['B1', 'B2'].map((id, i) => flight(`BBBB${id}`, times('good', 40), i * 60_000));
		expect(watched(...good).cells()).toEqual([]);
		const three = watched(...good, flight('BBBBB3', times('good', 40), 200_000));
		expect(three.cells()).toMatchObject([{ key: '0,0', aircraft: 3, degraded: 0, level: 'clear' }]);
	});

	test('one degraded aircraft is "some"; two and a quarter of them "many"', () => {
		const good = ['C1', 'C2', 'C3'].map((id, i) =>
			flight(`CCCC${id}`, times('good', 40), i * 60_000)
		);
		const bad = ['D1', 'D2'].map((id, i) =>
			flight(`DDDD${id}`, [...times('good', 5), ...times('degraded', 35)], 300_000 + i * 60_000)
		);
		expect(watched(...good, bad[0]).cells()[0]).toMatchObject({
			aircraft: 4,
			degraded: 1,
			level: 'some'
		});
		expect(watched(...good, ...bad).cells()[0]).toMatchObject({
			aircraft: 5,
			degraded: 2,
			level: 'many'
		});
		expect(watched(...good, ...bad).totals()).toEqual({ aircraft: 5, degraded: 2 });
	});

	test('an aircraft that goes silent about its position counts where it was last placed', () => {
		const watch = watched(flight('EEEE01', [...times('good', 10), ...times('none', 30)]));
		expect(watch.cellAircraft('0,0')).toMatchObject([{ icao: 'EEEE01', degraded: true }]);
	});

	test(`everything older than ${WINDOW_MS / 3_600_000} h goes`, () => {
		const watch = watched(flight('FFFF01', [...times('good', 10), ...times('degraded', 30)]));
		expect(watch.changes()).toHaveLength(1);
		watch.prune(WINDOW_MS + 30_000);
		expect(watch.changes()).toEqual([]);
		expect(watch.stretches()).toEqual([]);
		expect(watch.cellAircraft('0,0')).toEqual([]);
		expect(watch.aircraft()).toEqual([]);
	});
});

/** Frames through the tracker into a watch, as the live view does, but per message. */
function run(frames: BeastFrame[]): GnssWatch {
	const tracker = new Tracker(() => receiver);
	const filter = new AddressFilter();
	const watch = new GnssWatch(receiver);
	for (const f of frames) {
		if (f.kind === 'modeac') continue;
		const t = f.timestamp / 12_000;
		const addr = filter.check(f.data, t);
		if (!tracker.add(f.data, addr, t) || downlinkFormat(f.data) !== 17) continue;
		const o = observe(tracker.get(addr!.icao)!, f.data, t);
		if (o) watch.add(o);
	}
	return watch;
}

const frames = new BeastParser().push(capture);

describe('the capture', () => {
	const watch = run(frames);

	test('has no interference: no aircraft changes state', () => {
		expect(watch.changes()).toEqual([]);
	});

	test('two aircraft arrive without good navigation and leave without it', () => {
		const arrived = watch
			.aircraft()
			.filter((a) => a.arrived !== 'good')
			.map((a) => [a.callsign, a.arrived, a.wasGood]);
		expect(arrived).toEqual([
			['CCA749', 'none', false],
			['DLH895', 'degraded', false]
		]);
		expect(watch.stretches().map((s) => [s.icao, s.arrived])).toEqual([['3C6750', true]]);
	});
});

describe('the capture with a jammer in it (jamming-scenario.ts)', () => {
	const watch = run(injectJamming(frames));
	const changes = watch.changes();
	const lost = changes.filter((c) => c.kind === 'lost' && c.at);
	const regained = changes.filter((c) => c.kind === 'regained' && c.at);

	test('the aircraft flying in lose their GNSS at the edge, within a few seconds of flight', () => {
		expect(lost.map((c) => c.callsign)).toEqual(['AUA98F', 'BEL5XD', 'JSY3M', 'DLH4LW']);
		for (const c of lost) expect(Math.abs(distanceKm(c.at!, JAMMER) - JAMMED_KM)).toBeLessThan(2);
		// Odd addresses go silent (TC 0), even ones send TC 18.
		for (const c of changes) expect(c.other).toBe(parseInt(c.icao, 16) % 2 ? 'none' : 'degraded');
	});

	test(`and get it back outside, ${REACQUIRE_S} s of flight later`, () => {
		expect(regained.map((c) => c.callsign)).toEqual(['AUA995F', 'BEL5XD', 'THY1333']);
		// 450–480 kt: 7–7.5 km in 30 s, plus the HOLD messages, minus the angle it left at.
		for (const c of regained) {
			const d = distanceKm(c.at!, JAMMER);
			expect(d).toBeGreaterThan(JAMMED_KM + 2);
			expect(d).toBeLessThan(JAMMED_KM + 11);
		}
	});

	test('an aircraft first placed inside has a change but no place', () => {
		const unplaced = changes.filter((c) => !c.at).map((c) => [c.callsign, c.kind]);
		expect(unplaced).toEqual([[null, 'lost']]);
	});

	test('the cell south of the receiver, with most aircraft jammed, is "many"', () => {
		const cells = watch.cells().filter((c) => c.level === 'many');
		expect(cells).toHaveLength(1);
		expect(distanceKm(cells[0].center, JAMMER)).toBeLessThan(JAMMED_KM + CELL_KM);
	});
});
