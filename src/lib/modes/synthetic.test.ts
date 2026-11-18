/**
 * The decoders on what the capture doesn't contain: synthetic messages for every type code,
 * subtype and operational status version, DF18/19, DF16 coordination replies, and surface
 * positions, compared with pyModeS (tools/oracle-synthetic.py). Where pyModeS doesn't
 * decode something (DF18's CF, DO-260A target state, TC 31's capability bits), hand-made
 * cases check the layout instead.
 */
import { describe, expect, test } from 'bun:test';
import { resolutionAdvisory } from './acas';
import { decodeSurfaceGlobal, decodeSurfaceLocal } from './cpr';
import { checkParity, isDf17Format } from './crc';
import { esFormat, fromHex, payload, typeCode } from './frame';
import { messageHeader } from './header';
import { movement, surfacePosition } from './position';
import { extendedSquitter, imf, squitter } from './squitter';
import { aircraftSize, antennaOffset, operationalStatus, targetState } from './status';
import { surfaceOracle, syntheticOracle, type OracleEntry, encodeCpr } from './testing';

/** The ADS-B entries pyModeS decoded (DF17, and DF18 with an ADS-B layout; it skips DF19). */
const adsb = syntheticOracle.filter((o) => typeCode(o.data) !== null && 'typecode' in o);
const ofType = (...tcs: number[]) => adsb.filter((o) => tcs.includes(o.typecode));
const me = (o: OracleEntry) => payload(o.data)!;

/** The pyModeS names of the 3,0 fields, from ours (same mapping as registers.test.ts). */
function raFields(r: ReturnType<typeof resolutionAdvisory>) {
	return {
		issued_ra: r.active,
		corrective: r.corrective,
		downward_sense: r.downward,
		increased_rate: r.increasedRate,
		sense_reversal: r.senseReversal,
		altitude_crossing: r.altitudeCrossing,
		positive: r.positive,
		no_below: r.noBelow,
		no_above: r.noAbove,
		no_left: r.noLeft,
		no_right: r.noRight,
		ra_terminated: r.terminated,
		multiple_threat: r.multipleThreats
	};
}

test('every type code decodes to something', () => {
	const kinds: Record<number, Set<string>> = {};
	for (const o of adsb) (kinds[o.typecode] ??= new Set()).add(squitter(me(o)).kind);
	expect(Object.keys(kinds).length).toBe(32);
	expect([...kinds[23]]).toEqual(['test']);
	for (const tc of [24, 25, 26, 27, 30]) expect([...kinds[tc]]).toEqual(['reserved']);
	expect([...kinds[5]]).toEqual(['surface-position']);
	// TC 19 subtypes 0 and 5–7 are undefined.
	expect([...kinds[19]].sort()).toEqual(['reserved', 'velocity']);
});

describe('surface position (TC 5–8)', () => {
	test('agrees with pyModeS', () => {
		const positions = ofType(5, 6, 7, 8);
		expect(positions.length).toBeGreaterThan(60);
		for (const o of positions) {
			const p = surfacePosition(me(o))!;
			expect(p.movement.code).toBe(o.movement);
			// pyModeS gives the lower end of each range, on the version 0/1 scale.
			const v0 = movement(o.movement, 0).speed;
			expect(o.movement === 1 ? 0 : (v0?.min ?? null)).toBe(o.groundspeed);
			expect(p.track).toBe(o.track);
			expect(p.cpr).toEqual({
				format: o.cpr_format ? 'odd' : 'even',
				lat: o.cpr_lat,
				lon: o.cpr_lon
			});
		}
	});

	test('the movement scale, version 2', () => {
		expect(movement(0).speed).toBeNull();
		expect(movement(1)).toMatchObject({ stopped: true, speed: { min: 0, max: 0 } });
		expect(movement(2).speed).toEqual({ min: 0, max: 0.125 });
		expect(movement(8).speed!.max).toBeCloseTo(1, 12);
		expect(movement(9).speed).toEqual({ min: 1, max: 1.25 });
		expect(movement(39).speed).toEqual({ min: 15, max: 16 });
		expect(movement(123).speed).toEqual({ min: 170, max: 175 });
		expect(movement(124).speed).toEqual({ min: 175, max: null });
		expect(movement(125).speed).toBeNull();
		// Version 0/1: 0.125 kt steps up to 1 kt.
		expect(movement(2, 0).speed).toEqual({ min: 0.125, max: 0.25 });
		expect(movement(8, 1).speed).toEqual({ min: 0.875, max: 1 });
	});

	test('CPR: local and pair decoding agree with pyModeS', () => {
		expect(surfaceOracle.length).toBe(288);
		const close = (a: { lat: number; lon: number } | null, b: [number, number] | null) => {
			if (b === null) return expect(a).toBeNull();
			expect(a!.lat).toBeCloseTo(b[0], 9);
			// pyModeS doesn't wrap longitudes from local decoding into ±180°.
			expect(((a!.lon - b[1] + 540) % 360) - 180).toBeCloseTo(0, 9);
		};
		for (const c of surfaceOracle) {
			const reference = { lat: c.reference[0], lon: c.reference[1] };
			const even = { format: 'even' as const, lat: c.even[0], lon: c.even[1] };
			const odd = { format: 'odd' as const, lat: c.odd[0], lon: c.odd[1] };
			close(decodeSurfaceLocal(even, reference), c.local_even);
			close(decodeSurfaceLocal(odd, reference), c.local_odd);
			close(decodeSurfaceGlobal(even, odd, 'even', reference), c.pair_even_newer);
			close(decodeSurfaceGlobal(even, odd, 'odd', reference), c.pair_odd_newer);
		}
	});

	test("CPR: our test encoder (testing.ts) encodes like the oracle's", () => {
		for (const c of surfaceOracle) {
			const truth = { lat: c.truth[0], lon: c.truth[1] };
			const even = encodeCpr(truth, 'even', 90);
			const odd = encodeCpr(truth, 'odd', 90);
			expect([even.lat, even.lon]).toEqual(c.even);
			expect([odd.lat, odd.lon]).toEqual(c.odd);
		}
	});

	test('CPR: within a metre and a half of the true position', () => {
		for (const c of surfaceOracle) {
			const reference = { lat: c.reference[0], lon: c.reference[1] };
			const p = decodeSurfaceLocal({ format: 'even', lat: c.even[0], lon: c.even[1] }, reference);
			const metres =
				Math.hypot(
					p.lat - c.truth[0],
					(((p.lon - c.truth[1] + 540) % 360) - 180) * Math.cos((c.truth[0] * Math.PI) / 180)
				) * 111_320;
			expect(metres).toBeLessThan(1.5);
		}
	});
});

describe('velocity (TC 19), the flags', () => {
	test('intent change and IFR', () => {
		for (const o of ofType(19).filter((o) => o.subtype >= 1 && o.subtype <= 4)) {
			const v = squitter(me(o));
			if (v.kind !== 'velocity') throw new Error(o.message);
			expect(v.intentChange).toBe((me(o)[1] & 0x80) !== 0);
			expect(v.ifrCapability).toBe((me(o)[1] & 0x40) !== 0);
			expect(v.nacV).toBe(o.nac_v);
		}
	});
});

describe('aircraft status (TC 28)', () => {
	test('agrees with pyModeS in every subtype', () => {
		const statuses = ofType(28);
		expect(new Set(statuses.map((o) => o.subtype)).size).toBe(8);
		for (const o of statuses) {
			const s = squitter(me(o));
			if (s.kind !== 'aircraft-status') throw new Error(o.message);
			expect(s.subtype).toBe(o.subtype);
			expect(s.emergency).toBe(o.emergency_state ?? null);
			expect(s.squawk).toBe(o.squawk ?? null);
			if (o.subtype === 2) {
				expect(raFields(s.advisory!) as Record<string, unknown>).toEqual(
					Object.fromEntries(Object.keys(raFields(s.advisory!)).map((k) => [k, o[k]]))
				);
			} else {
				expect(s.advisory).toBeNull();
			}
		}
	});
});

describe('target state (TC 29)', () => {
	test('subtype 1 agrees with pyModeS', () => {
		const states = ofType(29).filter((o) => o.subtype === 1);
		expect(states.length).toBeGreaterThan(20);
		for (const o of states) {
			const t = targetState(me(o))!;
			if (t.subtype !== 1) throw new Error(o.message);
			expect(t.selectedAltitude?.feet ?? null).toBe(o.selected_altitude);
			expect(t.qnh ?? null).toBe(
				o.baro_pressure_setting === null ? null : Math.round(o.baro_pressure_setting * 10) / 10
			);
			expect(t.selectedHeading).toBe(o.selected_heading);
			expect([t.nacP, t.nicBaro, t.sil]).toEqual([o.nac_p, o.nic_baro, o.sil]);
			expect(t.tcasOperational).toBe(o.tcas_operational);
			expect(t.modes?.autopilot ?? null).toBe(o.autopilot);
			expect(t.modes?.lnav ?? null).toBe(o.lnav_mode);
		}
	});

	test('subtype 0 (DO-260A), by hand', () => {
		// TC 29, ST 0 | VDS 01 (MCP) | type 0 | 0 | cap 01 | mode 10 (maintaining)
		// | alt 0101101100 (364 → 35,400 ft) | HDS 11 (FMS) | 001011010 (90°) | 1 (track)
		// | mode 01 | NACp 1001 | NICbaro 1 | SIL 11 | 00000 | ACAS 10 | emergency 000
		const bitsString =
			'11101' + '00' + '01' + '0' + '0' + '01' + '10' + '0101101100' + '11' + '001011010' + '1' +
			'01' + '1001' + '1' + '11' + '00000' + '10' + '000'; // prettier-ignore
		expect(bitsString.length).toBe(56);
		const bytes = Uint8Array.from({ length: 7 }, (_, i) =>
			parseInt(bitsString.slice(8 * i, 8 * i + 8), 2)
		);
		expect(targetState(bytes)).toEqual({
			kind: 'target-state',
			subtype: 0,
			vertical: {
				source: 'MCP/FCU',
				altitude: 35_400,
				type: 'flight level',
				mode: 'maintaining',
				capability: 1
			},
			horizontal: { source: 'FMS/RNAV', angle: 90, type: 'track', mode: 'acquiring' },
			nacP: 9,
			nicBaro: 1,
			sil: 3,
			acas: { code: 2, operational: true },
			emergency: 0
		});
	});
});

describe('operational status (TC 31)', () => {
	test('agrees with pyModeS for versions 1 and 2', () => {
		const statuses = ofType(31);
		expect(new Set(statuses.map((o) => `${o.subtype}/${o.version}`)).size).toBeGreaterThan(12);
		for (const o of statuses) {
			const s = operationalStatus(me(o))!;
			expect(s.version).toBe(o.version);
			expect(s.subtype as unknown).toBe(['airborne', 'surface'][o.subtype] ?? o.subtype);
			expect(s.raw).toEqual({
				capabilityClass: o.capability_class,
				operationalMode: o.operational_mode
			});
			const known = o.subtype <= 1 && o.version >= 1 && o.version <= 2;
			if (!known) {
				expect([s.nacP, s.sil, s.hrd, s.capabilities, s.modes]).toEqual([
					null,
					null,
					null,
					s.capabilities,
					null
				]);
				continue;
			}
			expect([s.nicSupplementA, s.nacP, s.sil]).toEqual([o.nic_supplement_a, o.nac_p, o.sil]);
			expect(s.hrd).toBe(o.hrd ? 'magnetic' : 'true');
			expect(s.nicBaro).toBe(o.nic_baro ?? null);
			expect(s.silSupplement).toBe(o.sil_supplement ?? null);
		}
	});

	/** A TC 31 payload from its fields, as bit strings. */
	const status = (st: string, cc: string, om: string, version: string, rest: string) => {
		const s = '11111' + st + cc + om + version + rest;
		expect(s.length).toBe(56);
		return Uint8Array.from({ length: 7 }, (_, i) => parseInt(s.slice(8 * i, 8 * i + 8), 2));
	};

	test('surface, version 2', () => {
		// CC: 00 POA=1 1090in=1 00 B2low=0 UATin=1 NACv=010 NIC-C=1 | L/W 0111 (≤ 45 × 45 m)
		// OM: 00 RA=0 IDENT=0 ATC=1 SAF=0 SDA=10 | GPS offset: 101 (right 2 m) 00110 (10 m)
		// NIC-A 0, NACp 1010, 00, SIL 11, TAH 1 (heading), HRD 0, SIL-S 1, 0
		const s = operationalStatus(
			status(
				'001',
				'00110001' + '0101' + '0111',
				'00001010' + '10100110',
				'010',
				'0' + '1010' + '00' + '11' + '1' + '0' + '1' + '0'
			)
		)!;
		expect(s).toMatchObject({
			subtype: 'surface',
			version: 2,
			nacP: 10,
			sil: 3,
			silSupplement: 1,
			gva: null,
			nicBaro: null,
			surfaceDirection: 'heading',
			size: { code: 7, length: 45, width: 45 },
			antennaOffset: { lateral: 2, longitudinal: 10 },
			modes: { raActive: false, ident: false, atc: true, singleAntenna: false, sda: 2 }
		});
		expect(s.capabilities).toMatchObject({
			poa: true,
			es1090In: true,
			b2Low: false,
			uatIn: true,
			nacV: 2,
			nicSupplementC: 1,
			tcasOperational: null
		});
	});

	test('airborne, version 1: the ACAS bit is inverted, BAQ instead of GVA', () => {
		// CC: 00 notACAS=1 CDTI=1 00 ARV=1 TS=0 TC=01 000000 | OM: 00 RA=1 IDENT=0 ATC=0 000…
		const s = operationalStatus(
			status(
				'000',
				'0011' + '0010' + '0100' + '0000',
				'0010' + '0000' + '0000' + '0000',
				'001',
				'1' + '0111' + '01' + '10' + '1' + '1' + '00'
			)
		)!;
		expect(s).toMatchObject({
			version: 1,
			nicSupplementA: 1,
			nacP: 7,
			baq: 1,
			gva: null,
			sil: 2,
			nicBaro: 1,
			hrd: 'magnetic',
			silSupplement: null,
			modes: { raActive: true, ident: false, atc: false, singleAntenna: null, sda: null }
		});
		expect(s.capabilities).toMatchObject({
			tcasOperational: false,
			cdti: true,
			arv: true,
			ts: false,
			tc: 1,
			es1090In: null
		});
	});

	test('aircraft size and GPS antenna offset tables', () => {
		expect(aircraftSize(0, 2)).toEqual({ code: 0, length: null, width: null });
		expect(aircraftSize(0, 1)).toEqual({ code: 0, length: 15, width: 11.5 });
		expect(aircraftSize(12, 2)).toEqual({ code: 12, length: 75, width: 72.5 });
		expect(aircraftSize(15, 2)).toEqual({ code: 15, length: 85, width: 90 });
		expect(antennaOffset(0)).toMatchObject({ lateral: null, longitudinal: null });
		expect(antennaOffset(0b011_00001)).toMatchObject({ lateral: -6, longitudinal: 'applied' });
		expect(antennaOffset(0b100_11111)).toMatchObject({ lateral: 0, longitudinal: 60 });
	});
});

describe('test message (TC 23)', () => {
	test('subtype 7 carries a squawk', () => {
		for (const o of ofType(23)) {
			const s = squitter(me(o));
			if (s.kind !== 'test') throw new Error(o.message);
			expect(s.subtype).toBe((me(o)[0] & 0b111) as number);
			expect(s.squawk !== null).toBe(s.subtype === 7 && ((me(o)[1] << 5) | (me(o)[2] >> 3)) !== 0);
		}
	});
});

describe('DF18 and DF19', () => {
	const df18 = syntheticOracle.filter((o) => o.df === 18);

	test('the control field decides the layout', () => {
		expect(df18.length).toBe(8 * 8 * 3);
		for (const o of df18) {
			const cf = o.data[0] & 0b111;
			expect(messageHeader(o.data)).toEqual({ df: 18, control: cf });
			const format = esFormat(o.data);
			if ([3, 4, 7].includes(cf)) {
				expect(format).toBeNull();
				expect(extendedSquitter(o.data)).toBeNull();
				expect(typeCode(o.data)).toBeNull();
			} else {
				expect(format!.address as string).toBe(
					['icao', 'non-icao', 'imf', '', '', 'non-icao', 'imf'][cf]
				);
				// Same payload layout as DF17: pyModeS agrees on the type code.
				expect(typeCode(o.data)).toBe(o.typecode);
			}
		}
	});

	test('IMF: where the bit sits for each type code', () => {
		const at = (tc: number, bit: number) => {
			const field = new Uint8Array(7);
			field[0] = tc << 3;
			field[(bit - 1) >> 3] |= 0x80 >> ((bit - 1) & 7);
			return imf(field);
		};
		expect(at(11, 8)).toBe(true);
		expect(at(6, 21)).toBe(true);
		expect(at(19, 9)).toBe(true);
		expect(at(28, 56)).toBe(true);
		expect(at(29, 51)).toBe(true);
		expect(at(31, 56)).toBe(true);
		expect(at(11, 9)).toBe(false);
		expect(at(2, 8)).toBeNull(); // identification has none
	});

	test('DF19: decoded as ADS-B only if the CRC fits', () => {
		const df19 = syntheticOracle.filter((o) => o.df === 19);
		expect(df19.length).toBe(24);
		for (const o of df19) {
			const af = o.data[0] & 0b111;
			expect(messageHeader(o.data)).toEqual({ df: 19, application: af });
			// The generator gives every one a valid CRC: AF 0 is decoded, the rest isn't.
			expect(isDf17Format(o.data)).toBe(af === 0);
			expect(extendedSquitter(o.data) === null).toBe(af !== 0);
			expect(typeCode(o.data) === null).toBe(af !== 0);
			expect(checkParity(o.data) === null).toBe(af !== 0);
			// Same message, one parity bit off: AF 0 or not, it stays undecoded.
			const broken = o.data.slice();
			broken[13] ^= 1;
			expect(isDf17Format(broken)).toBe(false);
			expect(extendedSquitter(broken)).toBeNull();
			expect(typeCode(broken)).toBeNull();
			expect(checkParity(broken)).toBeNull();
		}
	});
});

test('DF24: Comm-D header', () => {
	// 11 0 1 0101 | 80 bits of data | parity
	const data = fromHex('d5' + '0123456789abcdef0123' + '000000');
	expect(messageHeader(data)).toEqual({ df: 24, ke: 1, nd: 5, md: '0123456789abcdef0123' });
});

test('DF16 coordination replies: the advisory agrees with pyModeS', () => {
	const replies = syntheticOracle.filter((o) => o.df === 16);
	expect(replies.length).toBe(64);
	for (const o of replies) {
		const ra = resolutionAdvisory(payload(o.data)!);
		const h = messageHeader(o.data);
		expect(h?.df === 16 && h.mv).toEqual({ kind: 'acas', advisory: ra });
		const expected = Object.fromEntries(Object.keys(raFields(ra)).map((k) => [k, o.ra[k]]));
		expect(raFields(ra) as Record<string, unknown>).toEqual(expected);
	}
});
