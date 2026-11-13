import { describe, expect, test } from 'bun:test';
import { inferRegister } from './comm-b';
import { fromHex } from './frame';
import { combineFine, FINE_SPAN, REGISTERS, type Register } from './registers';
import { commbOracle } from './testing';

/** The registers pyModeS decodes too. */
const PYMODES = ['1,0', '1,7', '2,0', '3,0', '4,0', '5,0', '6,0'];
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
		expect(compared).toBe(4191);
	});

	test('without ADS-B to compare with, the same register is picked (or none, if two fit)', () => {
		const hows: Record<string, number> = {};
		for (const o of commbOracle) {
			const inference = inferRegister(fromHex(o.mb), null);
			hows[inference.how] = (hows[inference.how] ?? 0) + 1;
			expect(inference.candidates.map((c) => c.bds).sort()).toEqual(Object.keys(o.valid).sort());
			if (inference.how === 'ambiguous') {
				// pyModeS then just takes the first; we say we don't know.
				expect(o.inferred).toEqual(['5,0', '6,0']);
			} else {
				expect(inference.best?.bds ?? null).toBe(o.inferred[0] ?? null);
			}
		}
		expect(hows).toEqual({
			'only candidate': 4121,
			fixed: 26,
			ambiguous: 22,
			unknown: 1297,
			empty: 1
		});
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
