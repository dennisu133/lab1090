import { describe, expect, test } from 'bun:test';
import { GICB_MAP, type Register } from '#lib/modes/registers.ts';
import { AIRCRAFT_TTL_MS, CommBAircraftList, registerStatuses } from './aircraft.ts';

const heading: Register = {
	bds: '6,0',
	heading: 90,
	ias: 280,
	mach: 0.78,
	baroRate: 0,
	inertialRate: 0
};
const gicb: Register = { bds: '1,7', supported: ['2,0', '4,0', '5,0', '6,0'] };

describe('CommBAircraftList', () => {
	test('counts replies and registers, keeps the latest EHS readings', () => {
		const list = new CommBAircraftList();
		list.add('3c6586', 1000, heading, null);
		list.add('3c6586', 2000, null, 'DLH4AB'); // empty or unidentified reply
		list.add('3c6586', 3000, { ...heading, ias: 290 }, null);
		const [a] = list.list();
		expect(a.replies).toBe(3);
		expect(a.lastRx).toBe(3000);
		expect(a.callsign).toBe('DLH4AB'); // kept once known
		expect(a.registers['6,0']).toEqual({ count: 2, lastRx: 3000 });
		expect(a.headingAndSpeed?.value.ias).toBe(290);
		expect(a.intention).toBeNull();
	});

	test('hands out new objects, so snapshots stay as they were', () => {
		const list = new CommBAircraftList();
		list.add('3c6586', 1000, heading, null);
		const before = list.list()[0];
		list.add('3c6586', 2000, gicb, null);
		expect(before.replies).toBe(1);
		expect(before.registers['1,7']).toBeUndefined();
		expect(list.list()[0]).not.toBe(before);
	});

	test('sorts by address and forgets aircraft after the TTL', () => {
		const list = new CommBAircraftList();
		list.add('4ca123', 0, null, null);
		list.add('3c6586', 10_000, null, null);
		expect(list.list().map((a) => a.icao)).toEqual(['3c6586', '4ca123']);
		list.prune(AIRCRAFT_TTL_MS + 1);
		expect(list.list().map((a) => a.icao)).toEqual(['3c6586']);
	});
});

describe('registerStatuses', () => {
	test('read, listed but not read, read but not listed', () => {
		const list = new CommBAircraftList();
		list.add('3c6586', 0, gicb, null);
		list.add('3c6586', 0, heading, null);
		list.add('3c6586', 0, { bds: '5,1', lat: 52, lon: 13, altitude: 36_000 }, null);
		expect(registerStatuses(list.list()[0], GICB_MAP)).toEqual([
			{ bds: '1,7', status: 'read' }, // 1,7 has no bit for itself: never "not listed"
			{ bds: '2,0', status: 'not read' },
			{ bds: '4,0', status: 'not read' },
			{ bds: '5,0', status: 'not read' },
			{ bds: '5,1', status: 'not listed' },
			{ bds: '6,0', status: 'read' }
		]);
	});

	test('without a 1,7, everything read is just read', () => {
		const list = new CommBAircraftList();
		list.add('3c6586', 0, { bds: '5,1', lat: 52, lon: 13, altitude: 36_000 }, null);
		expect(registerStatuses(list.list()[0], GICB_MAP)).toEqual([{ bds: '5,1', status: 'read' }]);
	});
});
