import { describe, expect, test } from 'bun:test';
import { bearing, distanceKm } from '#lib/geo.ts';
import { KM_PER_NM } from '#lib/units.ts';
import { decimalYear, magneticField } from '#lib/weather/wmm.ts';
import { advance, MAX_OPEN_TURN, motion, path, trueHeading, type Motion } from './motion';
import type { TrackedAircraft } from './tracker';

const at = <T>(value: T, tc = 19) => ({ value, t: 0, from: { kind: 'adsb' as const, tc } });

/** At 52°N 14°E at t = 0, eastbound at 480 kt, FL300; changes on top. */
function aircraft(changes: Partial<TrackedAircraft> = {}): TrackedAircraft {
	return {
		icao: 'ABC123',
		firstSeen: 0,
		lastSeen: 0,
		messages: 10,
		signal: null,
		adsb: true,
		callsign: null,
		registration: null,
		category: null,
		squawk: null,
		emergency: null,
		advisory: null,
		ident: null,
		altitude: at(30_000, 11),
		gnssHeight: null,
		onGround: false,
		surface: null,
		ground: at({ speed: 480, track: 90 }),
		turnRate: null,
		air: null,
		verticalRate: null,
		operational: null,
		nacP: null,
		positionCode: null,
		target: null,
		position: { lat: 52, lon: 14, t: 0, from: 'pair', surface: false },
		confirmed: true,
		rejected: 0,
		lastRejection: null,
		trail: [],
		commB: { intention: null, trackAndTurn: null, headingAndSpeed: null },
		...changes
	};
}

const op = (version: number, hrd: 'true' | 'magnetic' | null) =>
	at({ version, hrd, sil: 3, silSupplement: 0, nicA: 0, nicC: null }, 31);

const autopilot = (selectedHeading: number, lnav = false) =>
	at(
		{
			selectedAltitude: null,
			selectedHeading,
			qnh: null,
			modes: { autopilot: true, vnav: false, altitudeHold: false, approach: false, lnav }
		},
		29
	);

const start = { lat: 52, lon: 14 };
/** 480 kt in km/s. */
const KM_S = (480 * KM_PER_NM) / 3600;

describe('sideways', () => {
	test('straight: a great circle at the ground speed', () => {
		const m = motion(aircraft())!;
		const s = advance(start, m, 60);
		expect(distanceKm(start, s)).toBeCloseTo(KM_S * 60, 6);
		// Eastbound on a great circle the track turns south against the local north:
		// 14.8 km is 0.216° of longitude at 52°N, times sin 52° (the meridians' convergence).
		expect(s.track).toBeCloseTo(90 + 0.216 * Math.sin((52 * Math.PI) / 180), 2);
	});

	test('a slow drift of the track (< 0.2°/s) counts as straight', () => {
		expect(motion(aircraft({ turnRate: at(0.15) }))!.turnRate).toBe(0);
	});

	test('an open turn: followed for 90°, then the path stops', () => {
		// 1.5°/s right from east: 90° take 60 s. The radius r = v / ω (ω in rad/s), and a
		// quarter circle ends r√2 from the start, 45° to the right of the old track (135°).
		const m = motion(aircraft({ turnRate: at(1.5) }))!;
		expect(m.rollOut).toBeNull();
		const r = KM_S / ((1.5 * Math.PI) / 180);
		const { points, openTurnEnd } = path(
			{ ...start, t: 0, track: 90, altitude: 30_000, turned: 0 },
			m,
			180,
			5
		);
		expect(openTurnEnd).toBe(true);
		const end = points.at(-1)!;
		expect(end.turned).toBeCloseTo(MAX_OPEN_TURN, 9);
		expect(end.t).toBe(60_000);
		expect(end.track).toBeCloseTo(180, 0);
		// 1 s chords of the arc: within a metre of the true circle.
		expect(distanceKm(start, end)).toBeCloseTo(r * Math.SQRT2, 3);
		expect(bearing(start, end)).toBeCloseTo(135, 0);
	});

	test('in heading mode, the turn ends at the selected heading; then straight on', () => {
		const a = aircraft({
			turnRate: at(1.5),
			target: autopilot(120),
			operational: op(2, 'true')
		});
		const m = motion(a)!;
		expect(m.rollOut).toBe(120);
		expect(m.turnLeft).toBe(30);
		const s = advance(start, m, 60); // 20 s turning, 40 s straight
		expect(s.track).toBeCloseTo(120, 0); // plus the meridians' convergence
		expect(s.turned).toBeCloseTo(30, 9);
		const { openTurnEnd, points } = path(advance(start, m, 0), m, 180, 5);
		expect(openTurnEnd).toBe(false);
		expect(points.at(-1)!.t).toBe(180_000);
	});

	test('a magnetic selected heading is turned into a true one (World Magnetic Model)', () => {
		const declination = magneticField(52, 14, 0, decimalYear(0)).declination;
		const a = aircraft({
			turnRate: at(1.5),
			target: autopilot(120),
			operational: op(2, 'magnetic')
		});
		expect(motion(a)!.rollOut).toBeCloseTo(120 + declination, 9);
		// Version 1 says which too (HRD, DO-260A; readsb and jet1090 read it); version 0 has
		// no HRD bit: magnetic.
		const v1True = aircraft({ ...a, operational: op(1, 'true') });
		expect(motion(v1True)!.rollOut).toBeCloseTo(120, 9);
		const v1Magnetic = aircraft({ ...a, operational: op(1, 'magnetic') });
		expect(motion(v1Magnetic)!.rollOut).toBeCloseTo(120 + declination, 9);
		const v0 = aircraft({ ...a, operational: op(0, null) });
		expect(motion(v0)!.rollOut).toBeCloseTo(120 + declination, 9);
		expect(trueHeading(120, 'true', start, 0)).toBe(120);
	});

	test('LNAV steers along a route we can see nothing of: the end stays unknown', () => {
		expect(
			motion(aircraft({ turnRate: at(1.5), target: autopilot(120, true) }))!.rollOut
		).toBeNull();
	});

	test('turning away from the selected heading: it is already there (track = heading + drift)', () => {
		// Turning right, selected 85°: 355° further right. Autopilots turn the short way.
		const m = motion(aircraft({ turnRate: at(0.5), target: autopilot(85) }))!;
		expect(m.turnLeft).toBe(0);
		expect(advance(start, m, 30).track).toBeCloseTo(90, 0);
	});

	test('not moved along: on the ground, without a recent ground speed, with only air data', () => {
		expect(
			motion(aircraft({ position: { ...start, t: 0, from: 'pair', surface: true } }))
		).toBeNull();
		expect(
			motion(aircraft({ ground: { ...at({ speed: 480, track: 90 }), t: -11_000 } }))
		).toBeNull();
		expect(
			motion(
				aircraft({ ground: null, air: at({ speed: 253, type: 'IAS' as const, heading: 227 }) })
			)
		).toBeNull();
	});
});

describe('up and down', () => {
	const climbing = (changes: Partial<TrackedAircraft> = {}): Motion =>
		motion(aircraft({ verticalRate: at({ rate: 2000, source: 'baro' as const }), ...changes }))!;
	const selected = (feet: number, altitudeHold = false) =>
		at(
			{
				selectedAltitude: { feet, source: 'MCP/FCU' as const },
				selectedHeading: null,
				qnh: null,
				modes: { autopilot: true, vnav: false, altitudeHold, approach: false, lnav: true }
			},
			29
		);

	test('climbing at the vertical rate, levelling off at the selected altitude', () => {
		const m = climbing({ target: selected(34_000) });
		expect(m.levelOff).toBe(34_000);
		expect(advance(start, m, 60).altitude).toBe(32_000);
		expect(advance(start, m, 180).altitude).toBe(34_000);
	});

	test('a selected altitude the other way is not where it levels off', () => {
		expect(climbing({ target: selected(20_000) }).levelOff).toBeNull();
		expect(advance(start, climbing(), 180).altitude).toBe(36_000);
	});

	test('level: in altitude hold, or under 100 ft/min', () => {
		expect(climbing({ target: selected(30_000, true) }).verticalRate).toBe(0);
		const slow = motion(aircraft({ verticalRate: at({ rate: 64, source: 'baro' as const }) }))!;
		expect(advance(start, slow, 60).altitude).toBe(30_000);
	});

	test('the altitude is carried forward to the position time', () => {
		// Altitude from 3 s before the position, climbing 2,000 ft/min: +100 ft.
		const m = climbing({ altitude: { value: 30_000, t: -3000, from: { kind: 'adsb', tc: 11 } } });
		expect(m.altitude).toBeCloseTo(30_100, 9);
	});
});
