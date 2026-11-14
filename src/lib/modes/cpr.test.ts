import { describe, expect, test } from 'bun:test';
import { distanceKm } from '#lib/geo.ts';
import { CprPairs, decodeGlobal, decodeLocal, nl, type LatLon } from './cpr';
import { fromHex, payload } from './frame';
import { airbornePosition, type Cpr } from './position';
import { cprOracle, prng } from './testing';

/**
 * The encoder, as the aircraft runs it (DO-260B A.1.7.1): the inverse of decoding, for
 * testing with positions anywhere in the world. Rounds to the nearest 1/2^17 of a zone.
 */
function encode({ lat, lon }: LatLon, format: Cpr['format']): Cpr {
	const i = format === 'odd' ? 1 : 0;
	const mod = (a: number, b: number) => a - b * Math.floor(a / b);
	const dLat = 360 / (60 - i);
	const yz = Math.floor((131072 * mod(lat, dLat)) / dLat + 0.5);
	const rlat = dLat * (yz / 131072 + Math.floor(lat / dLat));
	const dLon = 360 / Math.max(nl(rlat) - i, 1);
	const xz = Math.floor((131072 * mod(lon, dLon)) / dLon + 0.5);
	return { format, lat: mod(yz, 131072), lon: mod(xz, 131072) };
}

function randomPoint(random: () => number, maxLat = 87): LatLon {
	return { lat: (random() * 2 - 1) * maxLat, lon: (random() * 2 - 1) * 180 };
}

const cprOf = (hex: string) => airbornePosition(payload(fromHex(hex))!)!.cpr!;

describe('NL, the number of longitude zones', () => {
	test('59 at the equator, 1 at the poles, symmetric', () => {
		expect(nl(0)).toBe(59);
		expect(nl(87)).toBe(2);
		expect(nl(87.0001)).toBe(1);
		expect(nl(90)).toBe(1);
		for (const lat of [10, 33.3, 48.2, 70]) expect(nl(-lat)).toBe(nl(lat));
	});

	test("drops by one exactly at each of pyModeS's boundaries", () => {
		const boundaries = cprOracle.nl_boundaries;
		expect(boundaries.length).toBe(58);
		boundaries.forEach((b, i) => {
			expect(nl(b - 1e-9)).toBe(59 - i);
			if (b < 87) expect(nl(b + 1e-9)).toBe(58 - i);
		});
	});
});

describe('global decoding (even + odd)', () => {
	test('round trip: anywhere in the world, within 20 m', () => {
		const random = prng(1090);
		let failed = 0;
		for (let k = 0; k < 5000; k++) {
			const p = randomPoint(random);
			const decoded = decodeGlobal(encode(p, 'even'), encode(p, 'odd'), k % 2 ? 'odd' : 'even');
			if (decoded === null) {
				// Allowed only on an NL boundary: the two grids round to different zone counts.
				expect(nl(p.lat - 0.001)).not.toBe(nl(p.lat + 0.001));
				failed++;
				continue;
			}
			expect(distanceKm(decoded, p)).toBeLessThan(0.02);
			// distanceKm doesn't mind 190° vs −170°, but a map would.
			expect(Math.abs(decoded.lon)).toBeLessThanOrEqual(180);
		}
		expect(failed).toBeLessThan(10);
	});

	test('agrees with pyModeS on the capture, pairing included', () => {
		const pairs = new CprPairs();
		let decoded = 0;
		for (const o of cprOracle.positions) {
			const ours = pairs.add(o.icao, cprOf(o.message), o.t * 1000);
			if (o.global === null) {
				expect(ours).toBeNull();
				continue;
			}
			expect(ours!.lat).toBeCloseTo(o.global[0], 9);
			expect(ours!.lon).toBeCloseTo(o.global[1], 9);
			decoded++;
		}
		expect(decoded).toBe(2664); // of 2,763: the rest had no partner within 10 s yet
	});
});

describe('local decoding (one message + a reference point)', () => {
	test('agrees with pyModeS on the capture', () => {
		const [lat, lon] = cprOracle.reference;
		for (const o of cprOracle.positions) {
			const ours = decodeLocal(cprOf(o.message), { lat, lon });
			expect(ours.lat).toBeCloseTo(o.local[0], 9);
			expect(ours.lon).toBeCloseTo(o.local[1], 9);
		}
	});

	test('round trip: correct with a reference up to 150 NM away, anywhere', () => {
		const random = prng(17);
		for (let k = 0; k < 5000; k++) {
			const p = randomPoint(random, 80);
			// a reference in a random direction, up to 150 NM (2.5° of latitude) away
			const angle = random() * 2 * Math.PI;
			const r = random() * 2.5;
			const reference = {
				lat: p.lat + r * Math.cos(angle),
				lon: p.lon + (r * Math.sin(angle)) / Math.cos((p.lat * Math.PI) / 180)
			};
			const decoded = decodeLocal(encode(p, k % 2 ? 'odd' : 'even'), reference);
			expect(distanceKm(decoded, p)).toBeLessThan(0.02);
			expect(Math.abs(decoded.lon)).toBeLessThanOrEqual(180);
		}
	});

	test('too far from the reference: off by exactly one zone, and nothing says so', () => {
		const p = { lat: 47.5, lon: 15 };
		const reference = { lat: p.lat + 3.5, lon: p.lon }; // 210 NM north: more than half a zone
		const decoded = decodeLocal(encode(p, 'even'), reference);
		expect(decoded.lat - p.lat).toBeCloseTo(6, 3); // one even zone = 6° (360 NM) north
		// A global pair still knows better, which is how /frames notices.
		const global = decodeGlobal(encode(p, 'even'), encode(p, 'odd'), 'even')!;
		expect(distanceKm(global, p)).toBeLessThan(0.02);
	});

	test('the newest message of a pair: local and global give exactly the same position', () => {
		const [lat, lon] = cprOracle.reference;
		for (const o of cprOracle.positions.filter((o) => o.global)) {
			const local = decodeLocal(cprOf(o.message), { lat, lon });
			expect(distanceKm(local, { lat: o.global![0], lon: o.global![1] })).toBeLessThan(1e-6);
		}
	});
});

test('the date line', () => {
	const p = { lat: -16.5, lon: 179.99 }; // Fiji
	const decoded = decodeLocal(encode(p, 'even'), { lat: -16, lon: -179.5 });
	expect(decoded.lon).toBeCloseTo(179.99, 3);
});

describe('CprPairs', () => {
	const p = { lat: 47.5, lon: 15 };

	test('pairs only within maxAge, and only the same aircraft', () => {
		const pairs = new CprPairs(10_000);
		expect(pairs.add('AAAAAA', encode(p, 'even'), 0)).toBeNull(); // nothing to pair with
		expect(pairs.add('BBBBBB', encode(p, 'odd'), 1000)).toBeNull(); // another aircraft
		expect(pairs.add('AAAAAA', encode(p, 'odd'), 10_000)).not.toBeNull(); // 10 s: still ok
		expect(pairs.add('AAAAAA', encode(p, 'even'), 20_001)).toBeNull(); // odd is 10.001 s old
	});

	test('prune forgets aircraft not heard from', () => {
		const pairs = new CprPairs(10_000);
		pairs.add('AAAAAA', encode(p, 'even'), 0);
		pairs.prune(10_001);
		expect(pairs.add('AAAAAA', encode(p, 'odd'), 10_001)).toBeNull();
	});
});
