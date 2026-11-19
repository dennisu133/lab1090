import { describe, expect, test } from 'bun:test';
import { distanceKm } from '#lib/geo.ts';
import { AddressFilter } from '#lib/modes/address-filter.ts';
import { downlinkFormat, fromHex, toHex, typeCode } from '#lib/modes/frame.ts';
import { timedMessages } from '#lib/modes/testing.ts';
import type { WireFrame } from '#lib/receiver-types.ts';
import { Tracker } from '#lib/tracker/tracker.ts';
import { bridges } from '#lib/tracker/trail.ts';
import { TRACK_HISTORY_MS, TrackHistory, VELOCITY_KEEP_MS } from './track-history';

/** The capture as the server sees it: wire frames with verdicts, rx = receiver time in ms. */
const filter = new AddressFilter();
const frames: WireFrame[] = timedMessages.map(({ t, data }, i) => ({
	id: i + 1,
	rx: t,
	ts: t * 12_000,
	sig: 100,
	hex: toHex(data),
	addr: filter.check(data, t)
}));
const end = frames.at(-1)!.rx;

function track(list: WireFrame[]): Tracker {
	const tracker = new Tracker(() => ({ lat: 52, lon: 14 }));
	for (const f of list) tracker.add(fromHex(f.hex), f.addr, f.rx);
	return tracker;
}

describe('TrackHistory on the capture', () => {
	const history = new TrackHistory();
	for (const f of frames) {
		const data = fromHex(f.hex);
		history.add(f, data, downlinkFormat(data), typeCode(data));
	}
	history.prune(end);
	const kept = history.frames;
	const isVelocity = (f: WireFrame) => typeCode(fromHex(f.hex)) === 19;
	const positions = kept.filter((f) => !isVelocity(f));
	const full = track(frames);
	const thin = track(kept);

	test('keeps about one position frame per aircraft every 4 s', () => {
		// Of the capture's 2,763 airborne positions (16 aircraft, 10 minutes): 18 %.
		expect(positions.length).toBe(498);
		expect(kept.every((f) => f.addr?.verdict === 'valid')).toBe(true);
	});

	test(`and a velocity frame every ${VELOCITY_KEEP_MS / 1000} s, for the trails' bridges`, () => {
		expect(kept.length - positions.length).toBe(179);
		const bridged = (t: Tracker) =>
			t.list().flatMap((a) => bridges(a.trail).map(([, to]) => `${a.icao} ${to.t}`));
		// All but one: there the newest velocity kept was 60.4 s old, just past VELOCITY_MS
		// (the one heard 4.8 s after it wasn't kept).
		expect(bridged(full).length).toBe(5);
		expect(bridged(thin).length).toBe(4);
		expect(bridged(full)).toEqual(expect.arrayContaining(bridged(thin)));
	});

	test('alternating the grids, so each pairs with the one before', () => {
		const byIcao = Map.groupBy(positions, (f) => f.addr!.icao);
		let alternating = 0;
		let pairs = 0;
		for (const list of byIcao.values()) {
			for (let i = 1; i < list.length; i++) {
				const odd = (f: WireFrame) => fromHex(f.hex)[6] & 0x04;
				if (list[i].rx - list[i - 1].rx > 10_000) continue; // a gap: no partner anyway
				pairs++;
				if (odd(list[i]) !== odd(list[i - 1])) alternating++;
			}
		}
		expect(alternating / pairs).toBeGreaterThan(0.95);
	});

	test('the same aircraft end up on the map, in the same place', () => {
		const placed = (t: Tracker) =>
			t
				.list()
				.filter((a) => a.position)
				.map((a) => a.icao);
		expect(placed(thin)).toEqual(placed(full));
		for (const a of thin.list().filter((a) => a.position)) {
			const b = full.get(a.icao)!;
			// The last kept frame can be up to ~4 s before the last one: at 480 kt, 1 km.
			expect(distanceKm(a.position!, b.position!)).toBeLessThan(1.2);
		}
		expect(thin.rejections).toEqual([]);
	});

	test('trails with at least 3/4 of the points', () => {
		// A kept frame sometimes waits for the other grid: ~5.5 s per point instead of ~4.7.
		for (const a of thin.list()) {
			const points = (t: Tracker) => t.get(a.icao)!.trail.flat().length;
			expect(points(thin)).toBeGreaterThanOrEqual(Math.floor(points(full) * 0.75));
		}
	});

	test(`forgets frames older than ${TRACK_HISTORY_MS / 60_000} minutes`, () => {
		history.prune(end + TRACK_HISTORY_MS);
		expect(history.frames.length).toBeLessThan(kept.length);
		history.prune(end + TRACK_HISTORY_MS + 1);
		expect(history.frames).toEqual([]);
	});
});
