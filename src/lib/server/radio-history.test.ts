import { describe, expect, test } from 'bun:test';
import type { DemodulatorStats } from '#lib/demod/demodulator.ts';
import type { DemodReport } from '#lib/receiver-types.ts';
import { POINT_MS, POINTS, RadioHistory } from './radio-history';

function report(totals: Partial<DemodulatorStats>, busyMs = 0): DemodReport {
	return {
		totals: {
			samples: 0,
			candidates: 0,
			noPreamble: 0,
			unknownFormat: 0,
			parity: 0,
			unheard: 0,
			decoded: 0,
			accepted: 0,
			repaired: 0,
			clipped: 0,
			level: 0,
			blocks: 0,
			levelSum: 0,
			...totals
		},
		busyMs,
		clock: null,
		lostMs: 0,
		gaps: 0,
		runs: 1,
		device: { tuner: null, name: null, serial: null, gain: 49.6 }
	};
}

describe('RadioHistory', () => {
	test('a point every 10 s with what happened in it', () => {
		const history = new RadioHistory(0);
		history.read(5_000, 10, report({ accepted: 9 }));
		expect(history.points).toEqual([]);
		history.read(
			POINT_MS,
			500,
			report(
				{
					samples: 24e6,
					accepted: 450,
					repaired: 5,
					clipped: 3,
					blocks: 366,
					levelSum: 366 * 0.01
				},
				700
			)
		);
		history.read(
			2 * POINT_MS,
			1100,
			report(
				{
					samples: 48e6,
					accepted: 1000,
					repaired: 10,
					clipped: 3,
					blocks: 732,
					levelSum: 366 * 0.01 + 366 * 0.1
				},
				1500
			)
		);
		const [first, second] = history.points;
		expect(first).toMatchObject({
			t: POINT_MS,
			ms: POINT_MS,
			messages: 500,
			demodulated: 455,
			clipped: 3,
			busyMs: 700,
			samples: 24e6
		});
		expect(first.noise).toBeCloseTo(-40, 1);
		expect(second).toMatchObject({ messages: 600, demodulated: 555, clipped: 0, busyMs: 800 });
		expect(second.noise).toBeCloseTo(-20, 1);
	});

	test('a Beast feed has messages only', () => {
		const history = new RadioHistory(0);
		history.read(POINT_MS, 42, null);
		expect(history.points[0]).toMatchObject({
			messages: 42,
			noise: null,
			candidates: null,
			busyMs: null
		});
	});

	test('keeps an hour', () => {
		const history = new RadioHistory(0);
		for (let k = 1; k <= POINTS + 10; k++) history.read(k * POINT_MS, k, null);
		expect(history.points.length).toBe(POINTS);
		expect(history.points[0].t).toBe(11 * POINT_MS);
	});

	test('the same failure again and again is one event, counted', () => {
		const history = new RadioHistory(0);
		expect(history.status({ state: 'connecting' }, 1)).toBeNull();
		expect(history.status({ state: 'connected' }, 2)?.state).toBe('connected');
		const busy = 'the RTL-SDR is in use by another program';
		const news = [];
		for (let t = 3; t < 6; t++)
			news.push(history.status({ state: 'waiting', retryInMs: 1000, retryAt: 0, reason: busy }, t));
		// Only the first is news (and said on the console: Receiver).
		expect(news.map((e) => e?.reason ?? null)).toEqual([busy, null, null]);
		expect(history.take(null).events.map((e) => [e.state, e.count])).toEqual([
			['connected', 1],
			['waiting', 3]
		]);
		history.status({ state: 'waiting', retryInMs: 1000, retryAt: 0, reason: busy }, 9);
		// Only what changed goes out with the next batch; a new subscriber gets it all.
		expect(history.take(null).events).toEqual([
			{ id: 2, t: 3, last: 9, state: 'waiting', reason: busy, count: 4 }
		]);
		expect(history.take(null).events).toEqual([]);
		expect(history.full(null).events.length).toBe(2);
	});
});
