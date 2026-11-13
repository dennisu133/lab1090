import { describe, expect, test } from 'bun:test';
import { AddressFilter } from './address-filter';
import { AdsbMemory, type Broadcast } from './adsb-memory';
import { replyAltitude } from './altitude';
import { inferRegister, type Inference } from './comm-b';
import { downlinkFormat, fromHex, payload, toHex } from './frame';
import { combineFine, REGISTERS, type PositionCoarse, type PositionFine } from './registers';
import { commbOracle, oracle, timedMessages } from './testing';

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
			adsb: addr.verdict === 'known' ? memory.get(addr.icao) : null
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
			const inference = inferRegister(mb, { now: 1000, replyAltitude: null, adsb });
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
			const inference = inferRegister(mb, { now: 1000, replyAltitude: null, adsb });
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
	const inference = inferRegister(mb, { now: 0, replyAltitude: null, adsb });
	expect(inference.best?.bds).toBe('5,0');
	const [track] = inference.best!.comparisons;
	expect(track.quantity).toBe('track');
	expect(track.difference).toBeCloseTo(2.05, 2);
	expect(track.ok).toBe(true);
});
