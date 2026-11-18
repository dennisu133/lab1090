import { describe, expect, test } from 'bun:test';
import { downlinkFormat, fromHex, payload, typeCode } from './frame';
import { airbornePosition } from './position';
import { extendedSquitter } from './squitter';
import { aircraftStatus, operationalStatus, targetState } from './status';
import { messages, oracle } from './testing';
import { velocity } from './velocity';

const ofType = (...tcs: number[]) => oracle.filter((o) => o.df === 17 && tcs.includes(o.typecode));
const me = (o: { data: Uint8Array }) => payload(o.data)!;

describe('airborne position (TC 9–18)', () => {
	test('agrees with pyModeS', () => {
		const positions = ofType(9, 10, 11, 12, 13, 14, 15, 16, 17, 18);
		expect(positions.length).toBe(2763);
		for (const o of positions) {
			const p = airbornePosition(me(o))!;
			expect(p.altitude.feet).toBe(o.altitude);
			expect(p.surveillanceStatus).toBe(o.surveillance_status);
			expect(p.nicB).toBe(o.nic_b);
			expect(p.cpr).toEqual({
				format: o.cpr_format ? 'odd' : 'even',
				lat: o.cpr_lat,
				lon: o.cpr_lon
			});
		}
	});

	test('TC 0: altitude, but no position', () => {
		const p = airbornePosition(payload(fromHex('8d78103b00c380000000002ba316'))!);
		expect(p).toMatchObject({ tc: 0, altitude: { feet: 38_000 }, cpr: null });
	});

	test('DF16 replies carry a copy of the position register', () => {
		// Same aircraft (4400F8), same altitude, as an ACAS long reply and as ADS-B.
		const acas = fromHex('80e1983a58c3a62a72b38c222e37');
		const adsb = fromHex('8d4400f858c3a2beccc74b9d3525');
		expect(airbornePosition(payload(acas)!)?.altitude.feet).toBe(38_050);
		expect(airbornePosition(payload(adsb)!)?.altitude.feet).toBe(38_050);
	});
});

describe('velocity (TC 19)', () => {
	test('agrees with pyModeS', () => {
		const velocities = ofType(19);
		expect(velocities.length).toBe(662);
		for (const o of velocities) {
			const v = velocity(me(o))!;
			expect(v.subtype).toBe(o.subtype);
			expect(v.nacV).toBe(o.nac_v);
			expect(v.verticalRate).toBe(o.vertical_rate);
			expect(v.verticalRateSource).toBe(o.vr_source === 'BARO' ? 'baro' : 'gnss');
			expect(v.gnssMinusBaro).toBe(o.geo_minus_baro);
			if (o.subtype === 1) {
				// pyModeS truncates the speed to whole knots; we keep the exact value.
				expect(Math.trunc(v.ground!.speed)).toBe(o.groundspeed);
				expect(v.ground!.track).toBeCloseTo(o.track, 9);
			} else {
				expect(v.air).toEqual({ speed: o.airspeed, type: o.airspeed_type, heading: o.heading });
			}
		}
	});

	test('by hand: 48E95B, from the very first live test', () => {
		// ME 99 15 82 8d f0 08 9c, bit by bit:
		//   10011 001 | 0 0 010 | 1 0110000010 | 1 0001101111 | 1 0 000000010 | 00 | 1 0011100
		//   TC 19 ST 1  IC IFR NACv  west 386−1     south 111−1    baro up  2−1        −(28−1)
		const v = velocity(payload(fromHex('8d48e95b9915828df0089c433e2e'))!)!;
		expect(v.subtype).toBe(1);
		expect(v.nacV).toBe(2);
		expect(v.ground!.speed).toBeCloseTo(Math.hypot(385, 110), 9); // 400.4 kt
		expect(v.ground!.track).toBeCloseTo(254.05, 2); // west-southwest
		expect(v.verticalRate).toBe(64);
		expect(v.verticalRateSource).toBe('baro');
		expect(v.gnssMinusBaro).toBe(-675);
	});
});

describe('aircraft status (TC 28)', () => {
	test('agrees with pyModeS', () => {
		const statuses = ofType(28);
		expect(statuses.length).toBe(6);
		for (const o of statuses) {
			expect(aircraftStatus(me(o))).toEqual({
				kind: 'aircraft-status',
				subtype: 1,
				emergency: o.emergency_state,
				squawk: o.squawk,
				advisory: null
			});
		}
	});
});

describe('target state (TC 29)', () => {
	test('agrees with pyModeS', () => {
		const states = ofType(29);
		expect(states.length).toBe(21);
		for (const o of states) {
			const t = targetState(me(o))!;
			if (t.subtype !== 1) throw new Error(`subtype ${t.subtype}`);
			expect(t.selectedAltitude?.feet ?? null).toBe(o.selected_altitude);
			if (t.selectedAltitude) expect(t.selectedAltitude.source).toBe(o.selected_altitude_source);
			expect(t.qnh).toBeCloseTo(o.baro_pressure_setting, 6);
			expect(t.selectedHeading).toBe(o.selected_heading);
			expect(t.nacP).toBe(o.nac_p);
			expect(t.nicBaro).toBe(o.nic_baro);
			expect(t.sil).toBe(o.sil);
			expect(t.tcasOperational).toBe(o.tcas_operational);
			expect(t.modes?.autopilot ?? null).toBe(o.autopilot);
			expect(t.modes?.vnav ?? null).toBe(o.vnav_mode);
			expect(t.modes?.altitudeHold ?? null).toBe(o.altitude_hold_mode);
			expect(t.modes?.approach ?? null).toBe(o.approach_mode);
			expect(t.modes?.lnav ?? null).toBe(o.lnav_mode);
		}
	});
});

describe('operational status (TC 31)', () => {
	test('agrees with pyModeS', () => {
		const statuses = ofType(31);
		expect(statuses.length).toBe(14);
		for (const o of statuses) {
			const s = operationalStatus(me(o))!;
			expect(s.subtype).toBe(o.subtype === 0 ? 'airborne' : o.subtype);
			expect(s.version).toBe(o.version);
			expect(s.nicSupplementA).toBe(o.nic_supplement_a);
			expect(s.nacP).toBe(o.nac_p);
			expect(s.sil).toBe(o.sil);
			expect(s.silSupplement).toBe(o.sil_supplement ?? null);
			expect(s.hrd).toBe(o.hrd ? 'magnetic' : 'true');
			expect(s.raw).toEqual({
				capabilityClass: o.capability_class,
				operationalMode: o.operational_mode
			});
		}
	});

	test('capability and mode bits', () => {
		// Air China 78103B: CC 0x2300, OM 0x0300
		const s = operationalStatus(payload(fromHex('8d78103bf8230003004008a780e4'))!)!;
		expect(s.capabilities).toEqual({
			tcasOperational: true,
			cdti: null,
			es1090In: false,
			uatIn: false,
			arv: true,
			ts: true,
			tc: 0,
			poa: null,
			b2Low: null,
			nacV: null,
			nicSupplementC: null
		});
		expect(s.modes).toEqual({
			raActive: false,
			ident: false,
			atc: false,
			singleAntenna: false,
			sda: 3
		});
		expect(s.gva).toBe(0); // ME bits 49–56: 0000 1000, so GVA 0 and NICbaro 1
		expect(s.nicBaro).toBe(1);
	});
});

test('extendedSquitter: every DF17 in the capture is decoded', () => {
	const kinds = new Map<string, number>();
	for (const data of messages) {
		if (downlinkFormat(data) !== 17) continue;
		const s = extendedSquitter(data);
		if (!s) throw new Error(`TC ${typeCode(data)} not decoded`);
		kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
	}
	expect(Object.fromEntries(kinds)).toEqual({
		identification: 267,
		'airborne-position': 26 + 2196 + 506 + 61,
		velocity: 2747,
		'aircraft-status': 132,
		'target-state': 1096,
		'operational-status': 514
	});
});
