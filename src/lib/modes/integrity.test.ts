import { describe, expect, test } from 'bun:test';
import { containment, containmentRadii, NAC_P_METRES, type Supplements } from './integrity';

const NM = 1852;
const v2 = (nicA: number | null, nicB = 0, nicC: number | null = null): Supplements => ({
	version: 2,
	nicA,
	nicB,
	nicC
});
const v1 = (supplement: number): Supplements => ({
	version: 1,
	nicA: supplement,
	nicB: 0,
	nicC: null
});

// DO-260B's NIC table (as pyModeS's TC_NICv2_lookup / NICv2 and readsb lay it out), with
// the radii in the spec's nautical miles.
describe('version 2 (DO-260B)', () => {
	test('type codes that say it alone', () => {
		expect(containment(9, v2(0))).toEqual({ nic: 11, rc: 7.5, assumed: false });
		expect(containment(10, v2(0))).toEqual({ nic: 10, rc: 25, assumed: false });
		expect(containment(12, v2(0))).toEqual({ nic: 7, rc: 0.2 * NM, assumed: false });
		expect(containment(14, v2(0))).toEqual({ nic: 5, rc: 1 * NM, assumed: false });
		expect(containment(15, v2(0))).toEqual({ nic: 4, rc: 2 * NM, assumed: false });
		expect(containment(17, v2(0))).toEqual({ nic: 1, rc: 20 * NM, assumed: false });
		expect(containment(18, v2(0))).toEqual({ nic: 0, rc: null, assumed: false });
		expect(containment(20, v2(0))).toEqual({ nic: 11, rc: 7.5, assumed: false });
		expect(containment(22, v2(0))).toEqual({ nic: 0, rc: null, assumed: false });
	});

	test('TC 11: NIC-A and NIC-B both 1 → NIC 9 (75 m), both 0 → NIC 8 (0.1 NM)', () => {
		expect(containment(11, v2(1, 1))).toEqual({ nic: 9, rc: 75, assumed: false });
		expect(containment(11, v2(0, 0))).toEqual({ nic: 8, rc: 0.1 * NM, assumed: false });
		// Mixed is undefined: the larger radius.
		expect(containment(11, v2(1, 0))).toEqual({ nic: 8, rc: 0.1 * NM, assumed: true });
	});

	test('TC 13: 0.3 NM (A0 B1), 0.5 NM (A0 B0), 0.6 NM (A1 B1)', () => {
		expect(containment(13, v2(0, 1))?.rc).toBeCloseTo(0.3 * NM, 9);
		expect(containment(13, v2(0, 0))?.rc).toBe(0.5 * NM);
		expect(containment(13, v2(1, 1))?.rc).toBeCloseTo(0.6 * NM, 9);
	});

	test('TC 16: NIC 3 (4 NM) with both bits, else NIC 2 (8 NM; pyModeS has 14,008 m)', () => {
		expect(containment(16, v2(1, 1))).toEqual({ nic: 3, rc: 4 * NM, assumed: false });
		expect(containment(16, v2(0, 0))).toEqual({ nic: 2, rc: 14_816, assumed: false });
	});

	test('surface: TC 7 by NIC-A, TC 8 by NIC-A and NIC-C', () => {
		expect(containment(5, v2(0))).toEqual({ nic: 11, rc: 7.5, assumed: false });
		expect(containment(7, v2(1))).toEqual({ nic: 9, rc: 75, assumed: false });
		expect(containment(7, v2(0))).toEqual({ nic: 8, rc: 0.1 * NM, assumed: false });
		expect(containment(8, v2(1, 0, 1))?.rc).toBeCloseTo(0.2 * NM, 9);
		expect(containment(8, v2(1, 0, 0))?.rc).toBeCloseTo(0.3 * NM, 9);
		expect(containment(8, v2(0, 0, 1))?.rc).toBeCloseTo(0.6 * NM, 9);
		expect(containment(8, v2(0, 0, 0))).toEqual({ nic: 0, rc: null, assumed: false });
	});
});

describe('version 1 (DO-260A): one NIC supplement, from TC 31', () => {
	test('TC 11, 13, 16', () => {
		expect(containment(11, v1(1))).toEqual({ nic: 9, rc: 75, assumed: false });
		expect(containment(11, v1(0))).toEqual({ nic: 8, rc: 0.1 * NM, assumed: false });
		expect(containment(13, v1(0))?.rc).toBe(0.5 * NM);
		expect(containment(13, v1(1))?.rc).toBeCloseTo(0.6 * NM, 9);
		expect(containment(16, v1(1))?.nic).toBe(3);
		expect(containment(16, v1(0))?.nic).toBe(2);
	});
});

describe('no operational status yet', () => {
	test('the larger radius, marked as assumed', () => {
		const none: Supplements = { version: null, nicA: null, nicB: 1, nicC: null };
		expect(containment(11, none)).toEqual({ nic: 8, rc: 0.1 * NM, assumed: true });
		expect(containment(13, none)).toEqual({ nic: 6, rc: 0.6 * NM, assumed: true });
		expect(containment(16, none)).toEqual({ nic: 2, rc: 8 * NM, assumed: true });
		expect(containment(9, none)).toEqual({ nic: 11, rc: 7.5, assumed: false });
	});
});

describe('version 0 (DO-260): no NIC, the HPL of the NUCp', () => {
	test('from the type code alone (pyModeS NUCp table)', () => {
		const v0: Supplements = { version: 0, nicA: null, nicB: 0, nicC: null };
		expect(containment(11, v0)).toEqual({ nic: null, rc: 185, assumed: false });
		expect(containment(16, v0)).toEqual({ nic: null, rc: 18_520, assumed: false });
		expect(containment(18, v0)).toEqual({ nic: null, rc: null, assumed: false });
	});
});

test('NACp: the 95 % bounds, 10 NM down to 3 m; 0 unknown', () => {
	expect(NAC_P_METRES[0]).toBeNull();
	expect(NAC_P_METRES[1]).toBe(10 * NM);
	expect(NAC_P_METRES[8]).toBeCloseTo(92.6, 9); // 0.05 NM; pyModeS rounds to 93
	expect(NAC_P_METRES.slice(9)).toEqual([30, 10, 3]);
	expect(containment(19, v2(0))).toBeNull(); // not a position
});

test('containment radii: every value a type code can stand for (versions 1 and 2)', () => {
	expect(containmentRadii(11)).toEqual([75, 0.1 * NM]);
	expect(containmentRadii(13)).toEqual([0.3 * NM, 0.5 * NM, 0.6 * NM]);
	expect(containmentRadii(18)).toEqual([null]);
	expect(containmentRadii(5)).toEqual([7.5]);
	expect(containmentRadii(8)).toEqual([null, 0.2 * NM, 0.3 * NM, 0.6 * NM]);
	for (const tc of [0, 4, 19, 23, 28, 29, 31]) expect(containmentRadii(tc)).toBeNull();
});
