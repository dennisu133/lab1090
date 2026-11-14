import { describe, expect, test } from 'bun:test';
import { distanceKm } from '#lib/geo.ts';
import { AddressFilter, type Checked } from '#lib/modes/address-filter.ts';
import { replyAltitude } from '#lib/modes/altitude.ts';
import type { LatLon } from '#lib/modes/cpr.ts';
import { downlinkFormat, toHex } from '#lib/modes/frame.ts';
import { replySquawk } from '#lib/modes/squawk.ts';
import { cprOracle, encodeCpr, registration21, timedMessages } from '#lib/modes/testing.ts';
import { AIRCRAFT_TTL_MS, Tracker, type TrackedAircraft } from './tracker';

/** Rounded from the capture itself, like the CPR oracle's reference (tools/README.md). */
const receiver = { lat: 52, lon: 14 };

/** The capture through the tracker, keeping each aircraft's last snapshot (no pruning). */
function runCapture() {
	const tracker = new Tracker(() => receiver);
	const filter = new AddressFilter();
	const last = new Map<string, TrackedAircraft>();
	/** Every altitude each aircraft was shown at. */
	const seenAltitudes = new Map<string, Set<number>>();
	/** Every position the tracker took, with the message it came from. */
	const taken: { t: number; hex: string; lat: number; lon: number }[] = [];
	for (const { t, data } of timedMessages) {
		const addr = filter.check(data, t);
		if (!tracker.add(data, addr, t)) continue;
		const a = tracker.get(addr!.icao)!;
		last.set(a.icao, a);
		if (a.altitude)
			seenAltitudes.set(a.icao, (seenAltitudes.get(a.icao) ?? new Set()).add(a.altitude.value));
		if (a.position?.t === t)
			taken.push({ t, hex: toHex(data), lat: a.position.lat, lon: a.position.lon });
	}
	return { tracker, aircraft: [...last.values()], taken, seenAltitudes };
}

const { tracker, aircraft, taken, seenAltitudes } = runCapture();
const byCallsign = (callsign: string) => aircraft.find((a) => a.callsign?.value === callsign)!;

describe('the capture', () => {
	test('every position the tracker took is the one pyModeS decodes', () => {
		const oracle = new Map<string, typeof cprOracle.positions>();
		for (const p of cprOracle.positions)
			oracle.set(p.message, [...(oracle.get(p.message) ?? []), p]);
		for (const p of taken) {
			const o = oracle.get(p.hex)!.find((o) => Math.abs(o.t * 1000 - p.t) < 1)!;
			const [lat, lon] = o.global ?? o.local;
			expect(distanceKm(p, { lat, lon })).toBeLessThan(0.001);
		}
		// pyModeS decoded 2,763; the other 36 came before an aircraft's first pair, or from
		// aircraft heard too briefly for one.
		expect(taken.length).toBe(2727);
		expect(cprOracle.positions.length).toBe(2763);
	});

	test('nothing to reject in a clean recording', () => {
		expect(tracker.rejections).toEqual([]);
		expect(aircraft.every((a) => a.rejected === 0)).toBe(true);
	});

	test('19 aircraft, all with ADS-B; 16 with a position, 13 of them confirmed', () => {
		expect(aircraft.length).toBe(19);
		expect(aircraft.every((a) => a.adsb)).toBe(true);
		expect(aircraft.filter((a) => a.position).length).toBe(16);
	});

	test("CCA749 stays at FL380: one corrupted DF16 reply said 73,400 ft (and 'on the ground')", () => {
		expect(byCallsign('CCA749').altitude?.value).toBe(38_000);
		expect(seenAltitudes.get('78103B')).toEqual(new Set([38_000]));
	});

	test('CCA749 broadcasts, but never a position: only TC 0 ("no position information")', () => {
		const cca = byCallsign('CCA749');
		expect(cca.messages).toBe(438);
		expect(cca.position).toBeNull();
		expect(cca.altitude?.value).toBe(38_000);
		expect(cca.squawk?.value).toBe('7546');
	});

	test('a long track: one segment, a point every 4–5 s', () => {
		const a = byCallsign('AUA98F');
		expect(a.trail.length).toBe(1);
		const [segment] = a.trail;
		expect(segment.length).toBe(100);
		// 4 s at least; more where messages were missed.
		const seconds = (segment.at(-1)!.t - segment[0].t) / 1000;
		expect(seconds).toBeCloseTo(472.4, 1);
		expect(seconds / (segment.length - 1)).toBeCloseTo(4.8, 1);
		// Level at FL350; the altitude comes in 25 ft steps, and once it read one step higher.
		expect(segment.filter((p) => p.altitude !== 35_000).map((p) => p.altitude)).toEqual([35_025]);
	});

	test('a weak one: gaps of more than 30 s split its trail', () => {
		expect(byCallsign('JAKE27').trail.map((s) => s.length)).toEqual([2, 4, 1, 6]);
	});

	test('EHS registers, only where ADS-B agrees', () => {
		const withAll = aircraft.filter((a) => Object.values(a.commB).every((r) => r !== null));
		expect(withAll.length).toBe(12);
		const bel = byCallsign('BEL5XD').commB;
		expect(bel.intention?.from).toBe('4,0');
		expect(bel.trackAndTurn?.from).toBe('5,0');
		expect(bel.headingAndSpeed?.from).toBe('6,0');
	});
});

describe('Tracker', () => {
	const df4 = timedMessages.find((m) => downlinkFormat(m.data) === 4)!.data;
	const df5 = timedMessages.find((m) => downlinkFormat(m.data) === 5)!.data;
	const as = (verdict: Checked['verdict']): Checked => ({
		icao: 'ABC123',
		source: 'parity',
		verdict,
		interrogator: null
	});

	test('radar replies with a verified address: altitude and squawk, once a second reply agrees', () => {
		const t = new Tracker(() => receiver);
		expect(t.add(df4, as('known'), 1000, -20)).toBe(true);
		expect(t.add(df5, as('known'), 1500)).toBe(true);
		expect(t.get('ABC123')).toMatchObject({ altitude: null, squawk: null, messages: 2 });
		t.add(df4, as('known'), 2000);
		t.add(df5, as('known'), 2500);
		const a = t.get('ABC123')!;
		expect(a.altitude).toEqual({ value: replyAltitude(df4).feet!, t: 2000, from: 'DF4 reply' });
		expect(a.squawk).toEqual({ value: replySquawk(df5), t: 2500, from: 'DF5 reply' });
		expect(a).toMatchObject({ adsb: false, position: null, messages: 4, firstSeen: 1000 });
	});

	/** A DF4 reply from ABC123 with another altitude: the 13-bit AC field (bits 20–32) replaced. */
	function df4At(feet: number) {
		const data = df4.slice();
		// Q = 1: 25 ft steps from −1,000 ft, 11 bits (up to 50,175 ft), with M and Q spliced in.
		const n = (feet + 1000) / 25;
		const ac = ((n >> 5) << 7) | (((n >> 4) & 1) << 5) | 0x10 | (n & 0xf);
		data[2] = (data[2] & 0xe0) | (ac >> 8);
		data[3] = ac & 0xff;
		expect(replyAltitude(data).feet).toBe(feet);
		return data;
	}

	test('one corrupted reply changes nothing; climbing at a normal rate does', () => {
		const t = new Tracker(() => receiver);
		t.add(df4At(35_000), as('known'), 0);
		t.add(df4At(35_000), as('known'), 1000);
		t.add(df4At(50_000), as('known'), 2000); // 15,000 ft in a second: corrupted (like CCA749's DF16)
		expect(t.get('ABC123')!.altitude?.value).toBe(35_000);
		t.add(df4At(35_100), as('known'), 6000); // 100 ft in 5 s: plausible right away
		expect(t.get('ABC123')!.altitude?.value).toBe(35_100);
		expect(t.heldBack).toBe(2); // the very first reply, and the corrupted one
	});

	test('a new squawk shows from the second reply on', () => {
		const t = new Tracker(() => receiver);
		const squawk = (code: number) => {
			const data = df5.slice();
			data[2] = (data[2] & 0xe0) | (code >> 8);
			data[3] = code & 0xff;
			return data;
		};
		t.add(squawk(0x0123), as('known'), 0);
		t.add(squawk(0x0123), as('known'), 1000);
		const before = t.get('ABC123')!.squawk!.value;
		t.add(squawk(0x0456), as('known'), 2000);
		expect(t.get('ABC123')!.squawk!.value).toBe(before);
		t.add(squawk(0x0456), as('known'), 3000);
		expect(t.get('ABC123')!.squawk!.value).not.toBe(before);
	});

	test('unverified addresses never make an aircraft: they may be made up by bit errors', () => {
		const t = new Tracker(() => receiver);
		expect(t.add(df4, as('unknown'), 1000)).toBe(false);
		expect(t.add(df4, null, 1000)).toBe(false);
		expect(t.list()).toEqual([]);
	});

	test('snapshots stay as they were', () => {
		const t = new Tracker(() => receiver);
		t.add(df4, as('known'), 1000);
		const before = t.get('ABC123')!;
		t.add(df5, as('known'), 2000);
		expect(before.messages).toBe(1);
		expect(before.squawk).toBeNull();
		expect(t.get('ABC123')).not.toBe(before);
	});

	test(`aircraft not heard for ${AIRCRAFT_TTL_MS / 1000} s are dropped`, () => {
		const t = new Tracker(() => receiver);
		t.add(df4, as('known'), 1000);
		t.prune(1000 + AIRCRAFT_TTL_MS);
		expect(t.list().length).toBe(1);
		t.prune(1001 + AIRCRAFT_TTL_MS);
		expect(t.list()).toEqual([]);
	});

	test('a registration from Comm-B 2,1, if it starts with the mark of the address (D for 3C…)', () => {
		const df21 = timedMessages.find((m) => downlinkFormat(m.data) === 21)!.data;
		const reply = (chars: string) => {
			const data = df21.slice();
			data.set(registration21([...chars]), 4); // MB: bytes 5–11
			return data;
		};
		const german: Checked = {
			icao: '3C6586',
			source: 'parity',
			verdict: 'known',
			interrogator: null
		};
		const t = new Tracker(() => receiver);
		t.add(reply('NABCD'), german, 1000); // not D…: random bits
		expect(t.get('3C6586')!.registration).toBeNull();
		t.add(reply('DAIZA'), german, 2000);
		expect(t.get('3C6586')!.registration).toEqual({ value: 'D-AIZA', t: 2000, from: '2,1' });
	});
});

/**
 * A DF17 surface position (CRC left zero: the tracker trusts the verdict it's given).
 * ME: TC (5) | MOV (7) | S (1) | TRK (7) | T (1) | F (1) | LAT-CPR (17) | LON-CPR (17)
 */
function surfaceFrame(icao: string, p: LatLon, format: 'even' | 'odd', mov: number, trk: number) {
	const data = new Uint8Array(14);
	const put = (first: number, count: number, value: number) => {
		for (let i = 0; i < count; i++) {
			const bit = first - 1 + i;
			if ((value >> (count - 1 - i)) & 1) data[bit >> 3] |= 0x80 >> (bit & 7);
		}
	};
	put(1, 5, 17); // DF17
	put(6, 3, 6); // CA 6: level 2+ transponder, either airborne or on the ground
	put(9, 24, parseInt(icao, 16));
	const cpr = encodeCpr(p, format, 90);
	const me = 33; // ME bit 1 is message bit 33
	put(me, 5, 7); // TC 7: surface position, NIC 7 (< 0.1 NM)
	put(me + 5, 7, mov);
	put(me + 12, 1, 1); // the track is valid
	put(me + 13, 7, trk);
	put(me + 21, 1, format === 'odd' ? 1 : 0);
	put(me + 22, 17, cpr.lat);
	put(me + 39, 17, cpr.lon);
	return data;
}

describe('on the ground', () => {
	test('surface positions: on the map, with the movement and no altitude', () => {
		const t = new Tracker(() => receiver);
		const addr: Checked = { icao: 'ABC123', source: 'clear', verdict: 'valid', interrogator: null };
		const apron = { lat: 52.1, lon: 14.2 };
		// MOV 20: 5.5–6 kt (from code 13 on: 2 kt + 0.5 kt per code). TRK 64: 64 × 360/128 = 180°.
		t.add(surfaceFrame('ABC123', apron, 'even', 20, 64), addr, 0);
		t.add(surfaceFrame('ABC123', apron, 'odd', 20, 64), addr, 500);
		t.add(surfaceFrame('ABC123', apron, 'even', 20, 64), addr, 1000);
		const a = t.get('ABC123')!;
		expect(a.onGround).toBe(true);
		expect(a.surface?.value.movement.speed).toEqual({ min: 5.5, max: 6 });
		expect(a.surface?.value.direction).toBe(180);
		expect(a.confirmed).toBe(true);
		expect(distanceKm(a.position!, apron)).toBeLessThan(0.002);
		expect(a.trail[0].map((p) => [p.ground, p.altitude])).toEqual([
			[true, null],
			[true, null]
		]);
	});
});
