import { describe, expect, test } from 'bun:test';
import { inferRegister } from './comm-b';
import { fromHex } from './frame';
import { combineFine, FINE_SPAN, RARE, REGISTERS, type Register } from './registers';
import { build, commbOracle as oracle, registration21 } from './testing';

/** pyModeS's inference with include_meteo, too (the oracle has it; see tools/oracle-commb.py). */
const commbOracle = oracle as ((typeof oracle)[number] & { inferred_meteo: string[] })[];

/** The registers pyModeS decodes too. */
const PYMODES = ['1,0', '1,7', '2,0', '3,0', '4,0', '5,0', '6,0', '4,4', '4,5'];
const spec = (bds: string) => REGISTERS.find((r) => r.bds === bds)!;

const TARGET_SOURCE: Record<string, string> = {
	unknown: 'unknown',
	'aircraft altitude': 'aircraft_altitude',
	'MCP/FCU': 'mcp_fcu',
	FMS: 'fms'
};

/** Our field names, mapped to pyModeS's (it leaves out fields whose status bit is 0). */
function asPyModeS(r: Register): Record<string, unknown> {
	switch (r.bds) {
		case '1,0':
			return {
				config: r.continuation,
				overlay_command_capability: r.overlay,
				acas_operational: r.acasOperational,
				mode_s_subnetwork_version: r.subnetworkVersion,
				transponder_level5: r.level5,
				mode_s_specific_services: r.specificServices,
				uplink_elm_throughput: r.uplinkElm,
				downlink_elm_throughput: r.downlinkElm,
				aircraft_identification_capability: r.identification,
				squitter_capability: r.squitter,
				surveillance_identifier_code: r.surveillanceIdentifier,
				common_usage_gicb_capability: r.gicbChanged,
				acas_hybrid_surveillance: r.acasHybrid,
				acas_resolution_advisory: r.acasRa,
				acas_rtca_version: r.acasVersion,
				dte_status: r.dteStatus
			};
		case '1,7':
			return { supported_bds: r.supported };
		case '2,0':
			return { callsign: r.callsign };
		case '3,0':
			return {
				threat_type_indicator: r.threat === null ? 0 : r.threat.type === 'address' ? 1 : 2,
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
				multiple_threat: r.multipleThreats,
				...(r.threat?.type === 'address' && { threat_icao: r.threat.icao }),
				...(r.threat?.type === 'position' && {
					threat_altitude: r.threat.altitude,
					threat_range: r.threat.rangeNm,
					threat_bearing: r.threat.bearing
				})
			};
		case '4,0':
			return withoutNulls({
				selected_altitude_mcp: r.mcpAltitude,
				selected_altitude_fms: r.fmsAltitude,
				baro_pressure_setting: r.baroSetting,
				vnav_mode: r.modes?.vnav,
				altitude_hold_mode: r.modes?.altitudeHold,
				approach_mode: r.modes?.approach,
				target_altitude_source: r.targetSource && TARGET_SOURCE[r.targetSource]
			});
		case '5,0':
			return withoutNulls({
				roll: r.roll,
				true_track: r.track,
				groundspeed: r.groundSpeed,
				track_rate: r.trackRate,
				true_airspeed: r.tas
			});
		case '6,0':
			return withoutNulls({
				magnetic_heading: r.heading,
				indicated_airspeed: r.ias,
				mach: r.mach,
				baro_vertical_rate: r.baroRate,
				inertial_vertical_rate: r.inertialRate
			});
		case '4,4':
			return withoutNulls({
				figure_of_merit: r.source,
				wind_speed: r.wind?.speed,
				wind_direction: r.wind?.direction,
				static_air_temperature: r.temperature,
				static_pressure: r.pressure,
				turbulence: r.turbulence,
				humidity: r.humidity
			});
		case '4,5':
			return withoutNulls({
				turbulence: r.turbulence,
				wind_shear: r.windShear,
				microburst: r.microburst,
				icing: r.icing,
				wake_vortex: r.wakeVortex,
				static_air_temperature: r.temperature,
				static_pressure: r.pressure,
				radio_height: r.radioHeight
			});
		default:
			throw new Error(`pyModeS doesn't decode ${r.bds}`);
	}
}

function withoutNulls(o: Record<string, unknown>) {
	return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
}

describe('against pyModeS: every Comm-B payload of the capture, and a bit-flipped copy of each', () => {
	test('the oracle has both kinds', () => {
		expect(commbOracle.filter((o) => o.real).length).toBe(2737);
		expect(commbOracle.filter((o) => !o.real).length).toBe(2730);
	});

	test('the same registers are possible, for the same reasons', () => {
		for (const o of commbOracle) {
			const mb = fromHex(o.mb);
			// All zeros: pyModeS rejects it in every register; inferRegister calls it "empty" first.
			const empty = mb.every((b) => b === 0);
			const ours = PYMODES.filter((bds) => !empty && spec(bds).reject(mb) === null);
			expect({ mb: o.mb, valid: ours }).toEqual({ mb: o.mb, valid: Object.keys(o.valid) });
		}
	});

	test('every possible register decodes to the same values', () => {
		let compared = 0;
		for (const o of commbOracle) {
			const mb = fromHex(o.mb);
			for (const [bds, theirs] of Object.entries(o.valid)) {
				const ours = asPyModeS(spec(bds).decode(mb));
				expect(Object.keys(ours).sort()).toEqual(Object.keys(theirs).sort());
				for (const [key, value] of Object.entries(theirs)) {
					if (typeof value === 'number') expect(ours[key] as number).toBeCloseTo(value, 9);
					else expect(ours[key]).toEqual(value);
				}
				compared++;
			}
		}
		expect(compared).toBe(4279);
	});

	test('without ADS-B to compare with, the same register is picked (or none, if two fit)', () => {
		const hows: Record<string, number> = {};
		for (const o of commbOracle) {
			const inference = inferRegister(fromHex(o.mb), null);
			const key = `${inference.how}${RARE.has(inference.best?.bds ?? '') ? ` ${inference.best!.bds}` : ''}`;
			hows[key] = (hows[key] ?? 0) + 1;
			// The rare registers (4,4, 4,5, 5,3) only count when no common one fits: pyModeS too
			// only tries 4,4/4,5 on request (include_meteo), and then puts them last.
			const valid = Object.keys(o.valid);
			const common = valid.filter((bds) => !RARE.has(bds));
			const expected = common.length > 0 ? common : valid;
			const inferred = common.length > 0 ? o.inferred : o.inferred_meteo;
			// pyModeS 3 doesn't know 5,3 (it's tested by hand below).
			const ours = inference.candidates.map((c) => c.bds).filter((bds) => bds !== '5,3');
			expect(ours.sort()).toEqual(expected.sort());
			if (inference.best?.bds === '5,3') {
				expect(inferred).toEqual([]);
			} else if (inference.how === 'ambiguous') {
				// pyModeS then just takes the first; we say we don't know.
				expect(inferred.length).toBeGreaterThan(1);
			} else {
				expect(inference.best?.bds ?? null).toBe(inferred[0] ?? null);
			}
		}
		expect(hows).toEqual({
			'only candidate': 4121,
			fixed: 26,
			ambiguous: 22,
			unknown: 1271,
			empty: 1,
			// Bit-flipped payloads nothing common fits: see the next test.
			'only candidate 4,4': 1,
			'only candidate 4,5': 16,
			'only candidate 5,3': 9
		});
	});

	test('only bit-flipped payloads fall through to the rare registers', () => {
		for (const o of commbOracle.filter((o) => o.real)) {
			const best = inferRegister(fromHex(o.mb), null).best?.bds ?? '';
			expect({ mb: o.mb, rare: RARE.has(best) }).toEqual({ mb: o.mb, rare: false });
		}
	});
});

describe('5,1 and 5,2 (layout inferred, not from the spec)', () => {
	test('5,1: two 20-bit coordinates and a 15-bit altitude, all two’s complement', () => {
		// Built by hand: lat +1/4 circle (90°), lon −1/8 circle (−45°), −1,000 ft.
		const mb = new Uint8Array(7);
		const set = (first: number, count: number, value: number) => {
			for (let i = 0; i < count; i++) {
				const bit = first - 1 + i;
				if ((value >> (count - 1 - i)) & 1) mb[bit >> 3] |= 0x80 >> (bit & 7);
			}
		};
		set(1, 1, 1);
		set(2, 20, 2 ** 18); // 90° = 2^18 × 360/2^20
		set(22, 20, 2 ** 20 - 2 ** 17); // −45°
		set(42, 15, 2 ** 15 - 125); // −125 × 8 ft
		expect(spec('5,1').decode(mb)).toEqual({ bds: '5,1', lat: 90, lon: -45, altitude: -1000 });
		expect(spec('5,1').reject(mb)).toBeNull();
	});

	test('5,2: fine latitude/longitude are the digits after 5,1’s', () => {
		// 5,1 truncates to 360/2^20; 5,2 counts 360/2^26 within a 1.40625° window. So the
		// combination lies 0–1 coarse steps north/east of the coarse position, never south.
		const coarse = 360 / 2 ** 20;
		for (const lat of [-33.123456, 0.000001, 47.999999, 51.4]) {
			const truncated = Math.floor(lat / coarse) * coarse;
			const fine = (((lat % FINE_SPAN) + FINE_SPAN) % FINE_SPAN) as number;
			const combined = combineFine(fine, truncated);
			expect(combined).toBeCloseTo(lat, 9);
			expect(combined - truncated).toBeGreaterThanOrEqual(0);
			expect(combined - truncated).toBeLessThan(coarse);
		}
	});

	test('5,1/5,2 are never picked without ADS-B to confirm them: too little structure', () => {
		const mb = fromHex('926fd8492e930c'); // a real 5,1
		expect(spec('5,1').reject(mb)).toBeNull();
		const inference = inferRegister(mb, null);
		expect(inference.how).toBe('unknown');
		expect(inference.rejected.find((r) => r.bds === '5,1')?.reason).toMatch(/too little structure/);
	});
});

test('an all-zero register is "empty", not a register', () => {
	expect(inferRegister(new Uint8Array(7), null)).toMatchObject({ how: 'empty', candidates: [] });
});

/** A 56-bit register, built field by field: [first bit, bit count, value] (two's complement). */

describe('5,3 air-referenced state vector (not in pyModeS 3: ICAO Doc 9871, pyModeS 2)', () => {
	test('every field: status bit, then the value; heading and rate two’s complement', () => {
		const mb = build(
			[1, 1, 1],
			[2, 11, -512], // −512 × 90/512 = −90°, i.e. 270°
			[13, 1, 1],
			[14, 10, 250],
			[24, 1, 1],
			[25, 9, 98], // × 0.008
			[34, 1, 1],
			[35, 12, 905], // × 0.5 kt
			[47, 1, 1],
			[48, 9, -16] // × 64 ft/min
		);
		expect(spec('5,3').reject(mb)).toBeNull();
		const r = spec('5,3').decode(mb);
		expect(r).toMatchObject({
			bds: '5,3',
			heading: 270,
			ias: 250,
			tas: 452.5,
			verticalRate: -1024
		});
		expect(r.bds === '5,3' && r.mach).toBeCloseTo(0.784, 9);
	});

	test('status 0 means "no data": null, and the value bits must be zero', () => {
		const onlyIas = build([13, 1, 1], [14, 10, 280]);
		expect(spec('5,3').decode(onlyIas)).toEqual({
			bds: '5,3',
			heading: null,
			ias: 280,
			mach: null,
			tas: null,
			verticalRate: null
		});
		expect(spec('5,3').reject(build([13, 1, 1], [14, 10, 280], [35, 12, 900]))).toBe(
			'true airspeed: status bit 34 says "no data", but its 12 value bits aren\'t zero'
		);
	});

	test('impossible values rule it out', () => {
		expect(spec('5,3').reject(build([24, 1, 1], [25, 9, 200]))).toBe('Mach 1.600 > 1');
		expect(spec('5,3').reject(build([47, 1, 1], [48, 9, -120]))).toBe(
			'vertical rate -7680 ft/min beyond ±6,000'
		);
	});
});

describe('2,1 aircraft and airline registration markings (ICAO Doc 9871 Table A-2-33)', () => {
	test('seven characters of the 2,0 alphabet, sent without the dash', () => {
		const mb = registration21([...'DAIZA']);
		expect(spec('2,1').reject(mb)).toBeNull();
		expect(spec('2,1').decode(mb)).toEqual({ bds: '2,1', registration: 'DAIZA', airline: null });
	});

	test("the dash's place may be filled: space, or code 0 or 45 (jet1090's finding)", () => {
		for (const gap of [' ', 0, 45]) {
			const mb = registration21(['B', gap, '2', '4', '8', '7']);
			expect(spec('2,1').reject(mb)).toBeNull();
			expect(spec('2,1').decode(mb)).toMatchObject({ registration: 'B2487' });
		}
	});

	test('the two airline characters, if their status bit says so', () => {
		const mb = registration21([...'DAIZA'], 'LH');
		expect(spec('2,1').reject(mb)).toBeNull();
		expect(spec('2,1').decode(mb)).toMatchObject({ airline: 'LH' });
		expect(spec('2,1').reject(build([1, 1, 1], [2, 6, 4], [45, 12, 1]))).toBe(
			'airline mark: status bit 44 says "no data", but its 12 value bits aren\'t zero'
		);
	});

	test('what rules it out', () => {
		expect(spec('2,1').reject(registration21([...'DAIZA'], null, 0))).toBe(
			'status bit 1 says "no registration"'
		);
		expect(spec('2,1').reject(registration21(['D', 27, 'I', 'Z', 'A']))).toBe(
			'a character is not a letter, digit or space'
		);
		for (const chars of [[' ', ...'DAIZA'], [...'D A IZA']])
			expect(spec('2,1').reject(registration21(chars))).toBe(
				'not a registration: it starts with a gap, or has more than one'
			);
		expect(spec('2,1').reject(registration21([...'DAIZA'], '#A'))).toBe(
			'an airline character is not a letter or digit'
		);
	});

	test('rare and weakly structured: never picked without an address to check it against', () => {
		expect(RARE.has('2,1')).toBe(true);
		const inference = inferRegister(registration21([...'DAIZA']), null);
		expect(inference.rejected.find((r) => r.bds === '2,1')?.reason).toBe(
			'too little structure to tell without a trusted address to check the nationality mark against'
		);
	});
});
