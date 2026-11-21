import { describe, expect, test } from 'bun:test';
import { judge, MAX_RC_M } from './navigation';

const v2 = { version: 2, nicA: 0 };

describe('judge', () => {
	test('GNSS-quality positions are good: NIC 7 and up with NACp 8 and up (14 CFR 91.227)', () => {
		// TC 9: NIC 11; TC 11 without supplements: NIC 8; TC 12: NIC 7, Rc exactly 0.2 NM.
		for (const tc of [9, 10, 11, 12]) expect(judge(tc, 0, v2, 8)?.state).toBe('good');
		expect(judge(12, 0, v2, 9)?.rc).toBe(MAX_RC_M);
		// GNSS height instead of barometric altitude: TC 20–21 have NIC 11 and 10.
		expect(judge(20, 0, v2, 10)?.state).toBe('good');
	});

	test('a larger containment radius, or NIC 0, is degraded', () => {
		// TC 13: NIC 6 (0.3–0.6 NM); TC 17: NIC 1, 20 NM; TC 18 and 22: NIC 0, unknown.
		for (const tc of [13, 14, 15, 16, 17, 18, 22])
			expect(judge(tc, 0, v2, 9)?.state).toBe('degraded');
		expect(judge(18, 0, v2, null)).toEqual({
			state: 'degraded',
			tc: 18,
			nic: 0,
			rc: null,
			nacP: null
		});
	});

	test('NACp below 8 is degraded however small the NIC; none received yet is judged by NIC alone', () => {
		expect(judge(9, 0, v2, 7)?.state).toBe('degraded');
		expect(judge(9, 0, v2, 0)?.state).toBe('degraded');
		expect(judge(9, 0, null, null)?.state).toBe('good');
	});

	test('TC 0 has no position; other type codes are not positions', () => {
		expect(judge(0, 0, v2, 9)?.state).toBe('none');
		for (const tc of [1, 4, 5, 8, 19, 23, 28, 29, 31]) expect(judge(tc, 0, v2, 9)).toBeNull();
	});

	test('version 0: the protection limit (HPL) instead of NIC, held to the same 0.2 NM', () => {
		const v0 = { version: 0, nicA: null };
		// DO-260 NUCp: TC 12 → HPL 370 m, TC 13 → 926 m.
		expect(judge(12, 0, v0, null)).toMatchObject({ state: 'good', nic: null, rc: 370 });
		expect(judge(13, 0, v0, null)?.state).toBe('degraded');
	});
});
