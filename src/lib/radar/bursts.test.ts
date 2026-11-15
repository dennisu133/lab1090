import { describe, expect, test } from 'bun:test';
import { BurstCollector } from './bursts';

describe('BurstCollector', () => {
	test('replies within 150 ms are one burst, timed at their middle', () => {
		const c = new BurstCollector();
		c.position('AAA000', 0, 52, 14);
		for (const t of [1000, 1010, 1030]) c.reply('SI 44', 'AAA000', t, t);
		c.reply('SI 44', 'AAA000', 6000, 6000); // the next turn: closes the first burst
		c.position('AAA000', 2000, 52.02, 14);
		const [burst] = c.take(2000);
		expect(burst).toMatchObject({ code: 'SI 44', icao: 'AAA000', replies: 3 });
		expect(burst.t).toBeCloseTo(1013.33, 2);
		// Interpolated between the positions at 0 and 2 s.
		expect(burst.lat).toBeCloseTo(52.01013, 5);
	});

	test('a burst waits for the next position, then gives up after 15 s', () => {
		const c = new BurstCollector();
		c.position('AAA000', 0, 52, 14);
		c.reply('SI 44', 'AAA000', 1000, 1000);
		c.reply('SI 44', 'BBB000', 1500, 1500); // another aircraft: makes the first one complete
		expect(c.take(1500)).toEqual([]); // waiting
		expect(c.take(10_000)).toEqual([]); // still waiting
		expect(c.take(17_000)).toEqual([]); // given up
		c.position('AAA000', 17_500, 52.1, 14);
		expect(c.take(17_500)).toEqual([]);
	});

	test('codes and aircraft are kept apart', () => {
		const c = new BurstCollector();
		c.position('AAA000', 0, 52, 14);
		c.position('BBB000', 0, 53, 14);
		c.reply('SI 44', 'AAA000', 1000, 1000);
		c.reply('SI 17', 'AAA000', 1005, 1005);
		c.reply('SI 44', 'BBB000', 1010, 1010);
		c.reply('SI 44', 'AAA000', 2000, 2000); // moves the clock on
		c.position('AAA000', 3000, 52, 14);
		c.position('BBB000', 3000, 53, 14);
		const bursts = c.take(3000);
		expect(bursts.map((b) => `${b.code} ${b.icao} ${b.replies}`)).toEqual([
			'SI 44 AAA000 1',
			'SI 17 AAA000 1',
			'SI 44 BBB000 1'
		]);
	});

	test('without a position before the burst there is none', () => {
		const c = new BurstCollector();
		c.reply('SI 44', 'AAA000', 1000, 1000);
		c.reply('SI 44', 'AAA000', 6000, 6000);
		c.reply('SI 44', 'BBB000', 7000, 7000); // moves the clock on: the second is complete
		c.position('AAA000', 2000, 52, 14);
		c.position('AAA000', 7000, 52, 14);
		expect(c.take(7000).map((b) => b.t)).toEqual([6000]);
	});
});
