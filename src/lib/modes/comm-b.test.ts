import { describe, expect, test } from 'bun:test';
import { AddressFilter } from './address-filter';
import { AdsbMemory, type Broadcast } from './adsb-memory';
import { replyAltitude } from './altitude';
import { inferRegister, type Inference } from './comm-b';
import { downlinkFormat, fromHex, payload, toHex } from './frame';
import { combineFine, REGISTERS, type PositionCoarse, type PositionFine } from './registers';
import { squitter } from './squitter';
import { commbOracle, oracle, registration21, timedMessages } from './testing';

interface Reply {
	t: number;
	icao: string;
	hex: string;
	inference: Inference;
}

/** The capture, in order: ADS-B into the memory, every Comm-B reply inferred against it. */
const replies: Reply[] = (() => {
	const filter = new AddressFilter();
	const memory = new AdsbMemory();
	const out: Reply[] = [];
	for (const { t, data } of timedMessages) {
		const df = downlinkFormat(data);
		const addr = filter.check(data, t);
		if (df === 17 && addr?.verdict === 'valid') memory.add(addr.icao, payload(data)!, t);
		if ((df !== 20 && df !== 21) || !addr) continue;
		const context = {
			now: t,
			replyAltitude: df === 20 ? replyAltitude(data).feet : null,
			adsb: addr.verdict === 'known' ? memory.get(addr.icao) : null,
			address: addr.verdict === 'known' ? addr.icao : null
		};
		out.push({
			t,
			icao: addr.icao,
			hex: toHex(data),
			inference: inferRegister(payload(data)!, context)
		});
	}
	return out;
})();

const pyModeS = new Map(oracle.map((o) => [o.message, (o.bds as string | undefined) ?? null]));

describe('the capture, with ADS-B to compare with', () => {
	test('every register pyModeS recognises, we recognise the same way', () => {
		const known = replies.filter((r) => pyModeS.get(r.hex));
		expect(known.length).toBe(8985);
		for (const r of known) expect(r.inference.best?.bds).toBe(pyModeS.get(r.hex)!);
	});

	test("and most of what it doesn't: position reports, ADS-B registers, empty ones", () => {
		const counts: Record<string, number> = {};
		for (const r of replies.filter((r) => !pyModeS.get(r.hex))) {
			const key = r.inference.best?.bds ?? r.inference.how;
			counts[key] = (counts[key] ?? 0) + 1;
		}
		expect(counts).toEqual({
			empty: 76,
			'5,1': 26,
			'5,2': 25,
			'0,5': 41,
			'0,8': 15,
			'0,9': 42,
			unknown: 1
		});
	});

	test('almost half of the ADS-B registers read via Comm-B are exact copies of a recent DF17', () => {
		const adsb = replies.filter((r) => ['0,5', '0,8', '0,9'].includes(r.inference.best?.bds ?? ''));
		const copies = adsb.filter((r) => r.inference.best!.comparisons[0].quantity === 'all 56 bits');
		expect(copies.length).toBe(45);
		expect(adsb.length).toBe(98);
	});

	test('5,2 completes the 5,1 sent 0.4 ms before it: fine minus coarse is within one coarse step', () => {
		const step = 360 / 2 ** 20; // 5,1's resolution
		let pairs = 0;
		for (let i = 1; i < replies.length; i++) {
			const [a, b] = [replies[i - 1], replies[i]];
			if (a.inference.best?.bds !== '5,1' || b.inference.best?.bds !== '5,2') continue;
			if (a.icao !== b.icao || b.t - a.t > 5) continue;
			const coarse = a.inference.best.register as PositionCoarse;
			const fine = b.inference.best.register as PositionFine;
			const dLat = combineFine(fine.latFine, coarse.lat) - coarse.lat;
			const dLon = combineFine(fine.lonFine, coarse.lon) - coarse.lon;
			// Truncated, not rounded: the fine position is always north-east of the coarse one.
			for (const d of [dLat, dLon]) {
				expect(d).toBeGreaterThanOrEqual(0);
				expect(d).toBeLessThan(step);
			}
			pairs++;
		}
		expect(pairs).toBe(19);
	});

	test("5,2's altitude: barometric for one aircraft, GNSS height for the others", () => {
		const quantity = new Map<string, Set<string>>();
		for (const r of replies.filter((r) => r.inference.best?.bds === '5,2')) {
			const height = r.inference.best!.comparisons.find((c) => c.unit === 'ft')!;
			expect(height.ok).toBe(true);
			quantity.set(r.icao, (quantity.get(r.icao) ?? new Set()).add(height.quantity));
		}
		expect(Object.fromEntries([...quantity].map(([icao, q]) => [icao, [...q]]))).toEqual({
			'44CE75': ['altitude'],
			'4400F8': ['GNSS height'],
			'3C65D4': ['GNSS height'],
			'4BAAC7': ['GNSS height']
		});
	});

	test('6,0: indicated airspeed and altitude predict the Mach number', () => {
		const machs = replies
			.filter((r) => r.inference.best?.bds === '6,0')
			.flatMap((r) => r.inference.best!.comparisons.filter((c) => c.quantity === 'Mach'));
		expect(machs.length).toBeGreaterThan(2500);
		expect(machs.every((c) => c.ok)).toBe(true);
		expect(Math.max(...machs.map((c) => c.difference!))).toBeLessThan(0.01);
	});

	test('the one reply nothing fits says why', () => {
		const [unknown] = replies.filter((r) => r.inference.how === 'unknown');
		const why = unknown.inference.rejected.find((r) => r.bds === '0,5')!.reason;
		expect(why).toBe('ADS-B disagrees: position 188.3 km off; altitude 12,450 ft vs 38,000 ft');
	});
});

describe('two registers fit: ADS-B decides', () => {
	// Bit-flipped payloads from the oracle that are a valid 5,0 *and* a valid 6,0.
	const both = commbOracle.filter((o) => '5,0' in o.valid && '6,0' in o.valid);
	const decode = (bds: string, mb: Uint8Array) => REGISTERS.find((r) => r.bds === bds)!.decode(mb);

	function broadcast(values: Partial<Broadcast>): Broadcast {
		return {
			callsign: null,
			altitude: null,
			gnssMinusBaro: null,
			position: null,
			ground: null,
			air: null,
			verticalRate: null,
			selectedAltitude: null,
			qnh: null,
			lastSeen: 0,
			recent: new Map(),
			...values
		};
	}

	test('there are such payloads', () => expect(both.length).toBe(22));

	test('ADS-B ground speed and track like the 5,0 reading: 5,0', () => {
		for (const o of both) {
			const mb = fromHex(o.mb);
			const r = decode('5,0', mb);
			if (r.bds !== '5,0' || r.groundSpeed === null || r.track === null) continue;
			const adsb = broadcast({
				ground: { value: { speed: r.groundSpeed + 5, track: r.track + 2 }, t: 0, from: 'TC 19' }
			});
			const inference = inferRegister(mb, { now: 1000, replyAltitude: null, adsb, address: null });
			expect(inference.how).toBe('ADS-B');
			expect(inference.best?.bds).toBe('5,0');
		}
	});

	test('ADS-B airspeed and heading like the 6,0 reading: 6,0', () => {
		let decided = 0;
		for (const o of both) {
			const mb = fromHex(o.mb);
			const r = decode('6,0', mb);
			if (r.bds !== '6,0' || r.ias === null || r.heading === null) continue;
			const adsb = broadcast({
				air: { value: { speed: r.ias, type: 'IAS', heading: r.heading }, t: 0, from: 'TC 19' }
			});
			const inference = inferRegister(mb, { now: 1000, replyAltitude: null, adsb, address: null });
			expect(inference.best?.bds).toBe('6,0');
			decided++;
		}
		expect(decided).toBeGreaterThan(5);
	});
});

test('angles are compared the short way round: 359° and 1° are 2° apart', () => {
	// A 5,0 with only a track: status bit 12, then −6 × 90/512 = −1.05°, i.e. 358.95°.
	const bits = (1n << (56n - 12n)) | (BigInt(2 ** 11 - 6) << (56n - 23n));
	const mb = fromHex(bits.toString(16).padStart(14, '0'));
	const adsb: Broadcast = {
		callsign: null,
		altitude: null,
		gnssMinusBaro: null,
		position: null,
		ground: { value: { speed: 450, track: 1 }, t: 0, from: 'TC 19' },
		air: null,
		verticalRate: null,
		selectedAltitude: null,
		qnh: null,
		lastSeen: 0,
		recent: new Map()
	};
	const inference = inferRegister(mb, { now: 0, replyAltitude: null, adsb, address: null });
	expect(inference.best?.bds).toBe('5,0');
	const [track] = inference.best!.comparisons;
	expect(track.quantity).toBe('track');
	expect(track.difference).toBeCloseTo(2.05, 2);
	expect(track.ok).toBe(true);
});

describe('ADS-B registers read via Comm-B: only an exact copy (or agreeing values) counts', () => {
	// Payloads (ME) of real DF17s from the capture.
	const ME = {
		'6,1': 'e10ba700000000', // TC 28: emergency status and squawk
		'6,2': 'ea4a5858001008', // TC 29: target state and status
		'6,5': 'f8230003004008' // TC 31: operational status
	};
	const nothing: Broadcast = {
		callsign: null,
		altitude: null,
		gnssMinusBaro: null,
		position: null,
		ground: null,
		air: null,
		verticalRate: null,
		selectedAltitude: null,
		qnh: null,
		lastSeen: 0,
		recent: new Map()
	};

	for (const [bds, hex] of Object.entries(ME)) {
		test(`${bds}: unknown alone, recognised when the aircraft just broadcast the same bits`, () => {
			const mb = fromHex(hex);
			const alone = inferRegister(mb, null);
			expect(alone.best?.bds).not.toBe(bds);
			expect(alone.rejected.find((r) => r.bds === bds)?.reason).toMatch(/too little structure/);

			const adsb = { ...nothing, recent: new Map([[hex, 0]]) };
			const copy = inferRegister(mb, { now: 2000, replyAltitude: null, adsb, address: null });
			expect(copy.best?.bds).toBe(bds);
			expect(copy.best?.comparisons[0]).toMatchObject({ quantity: 'all 56 bits', ok: true });
		});
	}

	test('6,2 is also confirmed by agreeing values: selected altitude and pressure setting', () => {
		const mb = fromHex(ME['6,2']);
		const [selected, qnh] = [{ feet: 38_016, source: 'MCP/FCU' as const }, 1012.8];
		const at = <T>(value: T) => ({ value, t: 0, from: 'TC 29' });
		const agree = { ...nothing, selectedAltitude: at(selected), qnh: at(qnh) };
		const inference = inferRegister(mb, {
			now: 1000,
			replyAltitude: null,
			adsb: agree,
			address: null
		});
		expect(inference.best?.bds).toBe('6,2');
		expect(inference.best?.comparisons.map((c) => c.quantity)).toEqual([
			'selected altitude',
			'pressure setting'
		]);

		const disagree = { ...agree, selectedAltitude: at({ ...selected, feet: 24_000 }) };
		const no = inferRegister(mb, { now: 1000, replyAltitude: null, adsb: disagree, address: null });
		expect(no.best?.bds).not.toBe('6,2');
		expect(no.rejected.find((r) => r.bds === '6,2')?.reason).toBe(
			'ADS-B disagrees: selected altitude 38,016 ft vs 24,000 ft'
		);
	});

	test('0,6: a surface position, as an exact copy', () => {
		// TC 7, movement 20, track valid: 64 × 360/128 = 180°, T 0, odd, CPR 1000 / 2000.
		const fields = [
			[5, 7],
			[7, 20],
			[1, 1],
			[7, 64],
			[1, 0],
			[1, 1],
			[17, 1000],
			[17, 2000]
		];
		let binary = '';
		for (const [count, value] of fields) binary += value.toString(2).padStart(count, '0');
		const mb = fromHex(BigInt(`0b${binary}`).toString(16).padStart(14, '0'));
		expect(squitter(mb)?.kind).toBe('surface-position');
		const adsb = { ...nothing, recent: new Map([[toHex(mb), 0]]) };
		expect(
			inferRegister(mb, { now: 500, replyAltitude: null, adsb, address: null }).best?.bds
		).toBe('0,6');
	});
});

describe('the rare registers (4,4, 4,5, 5,3) are a last resort', () => {
	const spec = (bds: string) => REGISTERS.find((r) => r.bds === bds)!;

	test('when a common register fits too, the rare one is set aside, and says why', () => {
		const both = commbOracle
			.map((o) => fromHex(o.mb))
			.find((mb) => spec('5,3').reject(mb) === null && spec('6,0').reject(mb) === null)!;
		const inference = inferRegister(both, null);
		expect(inference.candidates.map((c) => c.bds)).not.toContain('5,3');
		expect(inference.rejected.find((r) => r.bds === '5,3')?.reason).toMatch(/rarely asked for/);
	});

	test('5,3 alone fits, but ADS-B contradicts it: unknown', () => {
		const ias = (mb: Uint8Array) => {
			const r = spec('5,3').decode(mb);
			return r.bds === '5,3' ? r.ias : null;
		};
		const alone = commbOracle
			.map((o) => fromHex(o.mb))
			.find((mb) => inferRegister(mb, null).best?.bds === '5,3' && ias(mb) !== null)!;
		const adsb: Broadcast = {
			callsign: null,
			altitude: null,
			gnssMinusBaro: null,
			position: null,
			ground: null,
			air: { value: { speed: ias(alone)! + 100, type: 'IAS', heading: null }, t: 0, from: 'TC 19' },
			verticalRate: null,
			selectedAltitude: null,
			qnh: null,
			lastSeen: 0,
			recent: new Map()
		};
		const inference = inferRegister(alone, { now: 1000, replyAltitude: null, adsb, address: null });
		expect(inference.best).toBeNull();
		expect(inference.rejected.find((x) => x.bds === '5,3')?.reason).toMatch(
			/^ADS-B disagrees: indicated airspeed/
		);
	});
});

describe('2,1: the registration must start with the nationality mark of the address', () => {
	const at = (address: string | null) => ({ now: 0, replyAltitude: null, adsb: null, address });
	const daiza = registration21([...'DAIZA']);

	test('a German address (3C0000–3FFFFF) and D…: taken, with the dash put back', () => {
		const inference = inferRegister(daiza, at('3C6586'));
		expect(inference.how).toBe('only candidate');
		expect(inference.best?.bds).toBe('2,1');
		expect(inference.best?.comparisons).toMatchObject([
			{ quantity: 'registration', commB: 'D-AIZA', other: 'D-…', ok: true }
		]);
	});

	test('the same bits from a US address: random, not a registration', () => {
		const inference = inferRegister(daiza, at('A00001'));
		expect(inference.best).toBeNull();
		expect(inference.rejected.find((r) => r.bds === '2,1')?.reason).toBe(
			'The address disagrees: registration "DAIZA" vs "N…"'
		);
	});

	test('one block, several registers: the UK block also holds Bermuda (VP-B…)', () => {
		const best = inferRegister(registration21([...'VPBAB']), at('424242')).best;
		expect(best?.comparisons[0]).toMatchObject({ commB: 'VP-BAB', ok: true });
	});

	test('in the capture, every reply that has the shape of a 2,1 fails the check', () => {
		// Radars here don't ask for 2,1, so these are other registers' bits: 26 6,0s, one 5,2.
		const shaped = replies.filter((r) => {
			const mb = payload(fromHex(r.hex))!;
			return REGISTERS.find((s) => s.bds === '2,1')!.reject(mb) === null;
		});
		expect(shaped.length).toBe(27);
		for (const r of shaped) {
			const mb = payload(fromHex(r.hex))!;
			expect(['6,0', '5,2']).toContain(r.inference.best!.bds);
			const alone = inferRegister(mb, at(r.icao));
			expect(alone.rejected.find((x) => x.bds === '2,1')?.reason).toMatch(
				/^The address disagrees: registration/
			);
		}
	});
});
