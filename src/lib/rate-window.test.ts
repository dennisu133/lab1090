import { describe, expect, test } from 'bun:test';
import { perSecond, RateWindow } from './rate-window.ts';

describe('RateWindow', () => {
	test('nothing to say under a second', () => {
		const w = new RateWindow<number>();
		expect(w.add(0, 0)).toBeNull();
		expect(w.add(250, 10)).toBeNull();
		expect(w.add(1000, 40)).toEqual({ then: 0, seconds: 1 });
	});

	test('measures over the last 10 s at most', () => {
		const w = new RateWindow<number>();
		for (let t = 0; t <= 20_000; t += 250) w.add(t, t / 100);
		// 10 a second throughout: the window holds 10 s.
		const r = w.add(20_250, 202.5)!;
		expect(r.seconds).toBe(10);
		expect((202.5 - r.then) / r.seconds).toBeCloseTo(10);
	});

	test('after a gap the last two samples still give a rate', () => {
		const w = new RateWindow<number>();
		w.add(0, 0);
		w.add(1000, 10);
		// Over the gap: from the newest sample before it.
		expect(w.add(60_000, 70)).toEqual({ then: 10, seconds: 59 });
		expect(w.add(61_000, 80)).toEqual({ then: 70, seconds: 1 });
	});

	test('clear starts over', () => {
		const w = new RateWindow<number>();
		w.add(0, 0);
		w.clear();
		expect(w.add(5000, 50)).toBeNull();
	});
});

test('perSecond: key by key, a key new since then counts from 0', () => {
	expect(perSecond({ a: 30, b: 5 }, { a: 10 }, 2)).toEqual({ a: 10, b: 2.5 });
});
