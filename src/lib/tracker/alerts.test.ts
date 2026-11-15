import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { AddressFilter, type Checked } from '#lib/modes/address-filter.ts';
import { build, timedMessages } from '#lib/modes/testing.ts';
import { BeastParser } from '#lib/server/beast/parser.ts';
import { advisoryField, df17, encodeSquawk, injectAlerts, statusMe } from './alert-scenario';
import { activeAlerts, ADVISORY_MS, alertsOf, IDENT_MS, identing, type Alert } from './alerts';
import { Tracker } from './tracker';

const receiver = { lat: 52, lon: 14 };
const ADSB: Checked = { icao: 'ABC123', source: 'clear', verdict: 'valid', interrogator: null };
const REPLY: Checked = { ...ADSB, source: 'parity', verdict: 'known' };

const status = (emergency: number, squawk: string) => df17('ABC123', statusMe(emergency, squawk));
const advisory = (sense: 'up' | 'down', terminated = false) =>
	df17('ABC123', advisoryField(0xe2, { sense, terminated, threat: '3C6586' }));
/** DF5 (56 bits: a short reply): FS (6–8), ID (20–32). The tracker trusts the verdict given. */
const df5 = (squawk: string, fs = 0) =>
	build([1, 5, 5], [6, 3, fs], [20, 13, encodeSquawk(squawk)]);
/** An airborne position without a position (CPR all zero), with the SS field (bits 6–7). */
const position = (ss: number) => df17('ABC123', build([1, 5, 11], [6, 2, ss]));

function run(frames: [Uint8Array, Checked, number][]) {
	const t = new Tracker(() => receiver);
	for (const [data, addr, at] of frames) t.add(data, addr, at);
	return t.get('ABC123')!;
}

describe('emergencies', () => {
	test('squawk 7700 counts from the second message on', () => {
		expect(alertsOf(run([[status(1, '7700'), ADSB, 0]]), 0)).toEqual([]);
		const a = run([
			[status(1, '7700'), ADSB, 0],
			[status(1, '7700'), ADSB, 1000]
		]);
		expect(alertsOf(a, 1000)).toEqual([
			{
				kind: 'emergency',
				icao: 'ABC123',
				tier: 'emergency',
				since: 0,
				cause: 'general',
				squawk: '7700',
				state: 1
			}
		]);
	});

	test('dialling through 7700 on the way to another code is no emergency', () => {
		// 7000 → 2700 with a knob per digit: the first knob passes 7700 for a moment.
		const a = run([
			[status(0, '7000'), ADSB, 0],
			[status(0, '7700'), ADSB, 1000],
			[status(0, '2700'), ADSB, 2000],
			[status(0, '2700'), ADSB, 3000]
		]);
		expect(alertsOf(a, 3000)).toEqual([]);
	});

	test('7600 from radar replies alone, once a second reply agrees', () => {
		expect(alertsOf(run([[df5('7600'), REPLY, 0]]), 0)).toEqual([]);
		const a = run([
			[df5('7600'), REPLY, 0],
			[df5('7600'), REPLY, 4000]
		]);
		expect(alertsOf(a, 4000)).toMatchObject([
			{ kind: 'emergency', cause: 'radio', squawk: '7600', state: null, since: 0 }
		]);
	});

	test('medical and minimum fuel are cautions, unless the squawk is an emergency code', () => {
		const medical = run([
			[status(2, '1000'), ADSB, 0],
			[status(2, '1000'), ADSB, 1000]
		]);
		expect(alertsOf(medical, 1000)).toMatchObject([{ tier: 'caution', cause: 'medical' }]);
		const fuel = run([
			[status(3, '7700'), ADSB, 0],
			[status(3, '7700'), ADSB, 1000]
		]);
		expect(alertsOf(fuel, 1000)).toMatchObject([{ tier: 'emergency', cause: 'general' }]);
	});

	test('the state says more than the squawk: downed aircraft', () => {
		const a = run([
			[status(6, '7700'), ADSB, 0],
			[status(6, '7700'), ADSB, 1000]
		]);
		expect(alertsOf(a, 1000)).toMatchObject([{ tier: 'emergency', cause: 'downed' }]);
	});

	test('over with the next code from ATC', () => {
		const a = run([
			[status(1, '7700'), ADSB, 0],
			[status(1, '7700'), ADSB, 1000],
			[status(0, '3523'), ADSB, 2000]
		]);
		expect(alertsOf(a, 2000)).toEqual([]);
	});
});

describe('ACAS resolution advisories', () => {
	test('from the second message on, naming the threat', () => {
		expect(alertsOf(run([[advisory('up'), ADSB, 0]]), 0)).toEqual([]);
		const a = run([
			[advisory('up'), ADSB, 0],
			[advisory('up'), ADSB, 1000]
		]);
		const [ra] = alertsOf(a, 1000) as Extract<Alert, { kind: 'advisory' }>[];
		expect(ra).toMatchObject({ kind: 'advisory', tier: 'caution', since: 0, threat: '3C6586' });
		expect(ra.advisory).toMatchObject({ active: true, corrective: true, downward: false });
	});

	test('over when RAT says so, or when the messages stop', () => {
		const ended = run([
			[advisory('up'), ADSB, 0],
			[advisory('up'), ADSB, 1000],
			[advisory('up', true), ADSB, 2000]
		]);
		expect(alertsOf(ended, 2000)).toEqual([]);
		const silent = run([
			[advisory('up'), ADSB, 0],
			[advisory('up'), ADSB, 1000]
		]);
		expect(alertsOf(silent, 1000 + ADVISORY_MS)).toHaveLength(1);
		expect(alertsOf(silent, 1001 + ADVISORY_MS)).toEqual([]);
	});

	test('a DF16 coordination reply counts too (VDS 0x30)', () => {
		const reply = new Uint8Array(14);
		reply[0] = 16 << 3;
		reply.set(advisoryField(0x30, { sense: 'down', threat: '3C6586' }), 4);
		const a = run([
			[reply, REPLY, 0],
			[advisory('down'), ADSB, 500]
		]);
		expect(alertsOf(a, 500)).toMatchObject([{ kind: 'advisory', since: 0 }]);
	});
});

describe('IDENT', () => {
	test('SPI in two positions in a row; off with the next one without', () => {
		expect(identing(run([[position(3), ADSB, 0]]), 0)).toBe(false);
		const on = run([
			[position(3), ADSB, 0],
			[position(3), ADSB, 500]
		]);
		expect(identing(on, 500)).toBe(true);
		expect(identing(on, 500 + IDENT_MS + 1)).toBe(false);
		const off = run([
			[position(3), ADSB, 0],
			[position(3), ADSB, 500],
			[position(0), ADSB, 1000]
		]);
		expect(identing(off, 1000)).toBe(false);
	});

	test('from radar replies: FS 4 and 5', () => {
		const a = run([
			[df5('1000', 5), REPLY, 0],
			[df5('1000', 4), REPLY, 4000]
		]);
		expect(identing(a, 4000)).toBe(true);
	});
});

const captureFrames = new BeastParser().push(
	new Uint8Array(
		await Bun.file(join(import.meta.dir, '../../../fixtures/capture.beast')).arrayBuffer()
	)
);

describe('the capture', () => {
	test('has no alerts and no IDENT at all', () => {
		const tracker = new Tracker(() => receiver);
		const filter = new AddressFilter();
		for (const { t, data } of timedMessages) {
			const addr = filter.check(data, t);
			if (!tracker.add(data, addr, t)) continue;
			const a = tracker.get(addr!.icao)!;
			expect(alertsOf(a, t)).toEqual([]);
			expect(identing(a, t)).toBe(false);
		}
	});

	test('with the scenario mixed in (alert-scenario.ts), the alerts come and go on time', () => {
		const frames = injectAlerts(captureFrames).filter((f) => f.kind !== 'modeac');
		const t0 = frames[0].timestamp / 12_000;
		const tracker = new Tracker(() => receiver);
		const filter = new AddressFilter();
		/** At each checkpoint (s), what's active: "icao kind cause/sense". */
		const checkpoints = [20, 35, 65, 100, 230, 250, 310, 400, 430, 440, 450, 470];
		const seen = new Map<number, string[]>();
		const idents = new Map<number, string[]>();
		let next = 0;
		for (const f of frames) {
			const t = f.timestamp / 12_000;
			while (next < checkpoints.length && t - t0 >= checkpoints[next] * 1000) {
				const list = tracker.list();
				seen.set(
					checkpoints[next],
					activeAlerts(list, t).map((x) =>
						x.kind === 'emergency'
							? `${x.icao} ${x.cause} ${x.squawk ?? '-'}`
							: `${x.icao} RA ${x.advisory.downward ? 'down' : 'up'} vs ${x.threat}`
					)
				);
				idents.set(
					checkpoints[next],
					list.filter((a) => identing(a, t)).map((a) => a.icao)
				);
				next++;
			}
			const addr = filter.check(f.data, t);
			tracker.add(f.data, addr, t);
		}
		expect(Object.fromEntries(seen)).toEqual({
			20: [],
			35: ['440822 general 7700'],
			65: ['440822 general 7700'],
			100: ['440822 general 7700'],
			230: [],
			250: ['501C2B medical -'],
			310: ['3C65D4 radio 7600', '501C2B medical -'],
			400: ['3C65D4 radio 7600'],
			430: ['4BAAC7 RA down vs 44CE75', '44CE75 RA up vs 4BAAC7'].sort(),
			440: ['4BAAC7 RA down vs 44CE75', '44CE75 RA up vs 4BAAC7'].sort(),
			450: [],
			470: []
		});
		expect(idents.get(65)).toEqual(['44CE75']);
		expect(idents.get(100)).toEqual([]);
	});
});
