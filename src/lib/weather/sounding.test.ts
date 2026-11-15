/**
 * The capture against an independent measurement: the weather balloons of the German
 * Weather Service's observatory at Lindenberg (WMO station 10393, 52.21°N 14.12°E)
 * (fixtures/sounding/, from tools/sounding.ts).
 *
 * A radiosonde measures pressure, temperature, humidity and (by GPS) its position as it
 * rises at about 5 m/s; the wind is how it drifts. Lindenberg launches four a day. Two
 * bracket the capture (15:18–15:28 UTC): one launched 10:45 UTC, one 16:45 UTC; each took
 * about 35 minutes to FL350, by then 30–50 km east of the launch. Each value below is
 * interpolated in time between the two, to when the aircraft was there.
 *
 * So differences have three sources: our errors, the weather changing while the balloons
 * were away (the two differ by about 1 K at cruise), and the weather differing from place
 * to place (the aircraft are up to 200 km away).
 *
 * The sea-level pressure isn't in the capture (every aircraft was on standard), so it's
 * taken from Berlin Brandenburg airport's weather report at 15:20 UTC,
 * "EDDB 131520Z AUTO 28016KT 9999 SCT041 08/01 Q1007" (Iowa Environmental
 * Mesonet's METAR archive). Q1007: QNH 1007 hPa.
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import { isaTemperature, pressureAltitude, staticPressure } from '#lib/modes/air-data.ts';
import { R_OVER_G_FT, column, feetPerKelvin, pressurePart } from './column';
import { contrail, humidityOf } from './contrail';
import { enough, layers, strongestWind, tropopause } from './profile';
import {
	atPressure,
	balloonTropopause,
	CAPTURE_START,
	inLayer,
	loadSounding,
	qnhOf,
	runCapture,
	type Sounding,
	type SoundingLevel
} from './testing';
import { geostrophicWind } from './geostrophic';
import { applyHeadingChecks, headingChecks } from './headings';
import {
	angleDifference,
	directionOf,
	meanWind,
	speedOf,
	toVector,
	windOf,
	type Vector
} from './wind';

const QNH = 1007;
const FT = 0.3048;

let morning: Sounding;
let evening: Sounding;
beforeAll(async () => {
	morning = await loadSounding('10393-2026-11-13-12z');
	evening = await loadSounding('10393-2026-11-13-18z');
});

const { pipeline, observations } = runCapture();
const sky = pipeline.sky.samples;
const all = layers(sky.temperatures, sky.winds, sky.columns);

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const rms = (xs: number[]) => Math.sqrt(mean(xs.map((x) => x * x)));
const byAircraft = <T extends { icao: string }>(xs: T[]) => Map.groupBy(xs, (x) => x.icao);

/** The two balloons at a pressure, interpolated to a moment in between. */
function balloon(pascal: number, time: number) {
	const a = atPressure(morning, pascal);
	const b = atPressure(evening, pascal);
	const k = (time - a.time) / (b.time - a.time);
	const mix = (x: number, y: number) => x + k * (y - x);
	return {
		height: mix(a.height, b.height),
		kelvin: mix(a.kelvin, b.kelvin),
		wind: { north: mix(a.wind.north, b.wind.north), east: mix(a.wind.east, b.wind.east) }
	};
}

/** The column's ISA deviation (column.ts) from a balloon's height at a pressure altitude. */
function balloonColumn(s: Sounding, altitude: number): number {
	const qnh = qnhOf(s);
	const { height } = atPressure(s, staticPressure(altitude));
	return (height - altitude - pressurePart(qnh)) / feetPerKelvin(altitude, qnh);
}

/** Air with water vapour is lighter: the temperature dry air of the same density would have. */
const virtual = (l: SoundingLevel) => l.kelvin * (1 + 0.61 * l.mixingRatio);

describe("Lindenberg's balloons on their own", () => {
	test('their ground pressure, reduced to sea level, brackets the airport’s QNH of 1007 hPa', () => {
		// QNH is the ground pressure taken down to sea level through the standard atmosphere,
		// whatever the real temperature (testing.ts). The pressure rose during the afternoon:
		// EDDB reported Q1004 at 10:50 and Q1008 at 16:50 UTC.
		expect(morning.levels[0].pressure / 100).toBe(990.6); // 112 m up
		expect(qnhOf(morning)).toBeCloseTo(1003.9, 1);
		expect(qnhOf(evening)).toBeCloseTo(1008.3, 1);
	});

	test("their heights follow from their temperatures by column.ts's hypsometric equation", () => {
		// Stack up the thickness of each slice, (R / g) · T̄ · ln(p₁ / p₂), from the ground.
		// With the virtual temperature (humidity included) that lands within 10 ft of every
		// height the balloon reports up to 150 hPa (FL445); dry air, as column.ts assumes,
		// within 30 ft: 0.2 K at FL350. The radiosonde computes its heights the same way, so
		// this checks our R / g and the humidity shortcut, not the balloon.
		for (const s of [morning, evening]) {
			let height = s.levels[0].height;
			let dry = height;
			const off = { height: 0, dry: 0 };
			for (let i = 1; i < s.levels.length && s.levels[i].pressure > 15_000; i++) {
				const [a, b] = [s.levels[i - 1], s.levels[i]];
				const lnp = Math.log(a.pressure / b.pressure);
				height += (R_OVER_G_FT * (virtual(a) + virtual(b)) * lnp) / 2;
				dry += (R_OVER_G_FT * (a.kelvin + b.kelvin) * lnp) / 2;
				off.height = Math.max(off.height, Math.abs(height - b.height));
				off.dry = Math.max(off.dry, Math.abs(dry - b.height));
			}
			expect(off.height).toBeLessThan(10);
			expect(off.dry).toBeGreaterThan(20);
			expect(off.dry).toBeLessThan(30);
		}
	});

	test('the column ISA deviation is the ln p-weighted mean of the temperatures below', () => {
		// What column.ts says its number means, checked on real air: the deviation from its
		// heights (as we compute it from GNSS heights) against the mean of (T − ISA) over
		// ln p, from QNH up (the ground's temperature taken down to sea level, 112 m).
		for (const s of [morning, evening]) {
			const qnh = qnhOf(s) * 100;
			for (const altitude of [35_000, 37_000, 39_000]) {
				const top = staticPressure(altitude);
				const below = s.levels.filter((l) => l.pressure >= top);
				const deviation = (l: SoundingLevel) =>
					virtual(l) - isaTemperature(pressureAltitude(l.pressure));
				let sum = deviation(below[0]) * Math.log(qnh / below[0].pressure);
				for (let i = 1; i < below.length; i++) {
					const [a, b] = [below[i - 1], below[i]];
					sum += ((deviation(a) + deviation(b)) / 2) * Math.log(a.pressure / b.pressure);
				}
				const fromTemperatures = sum / Math.log(qnh / below.at(-1)!.pressure);
				expect(Math.abs(balloonColumn(s, altitude) - fromTemperatures)).toBeLessThan(0.15);
			}
		}
		expect(balloonColumn(morning, 35_000)).toBeCloseTo(-5.5, 1);
		expect(balloonColumn(evening, 35_000)).toBeCloseTo(-6.5, 1);
	});

	test('the tropopause: FL332 at 11:15, FL271 at 17:10, as colder air came in', () => {
		// The wind at cruise veered from 255° to 280° and the pressure rose at the same time:
		// the air mass changed during the afternoon.
		const at = (s: Sounding) => {
			const t = balloonTropopause(s)!;
			return [Math.round(pressureAltitude(t.pressure) / 100), Math.round(t.kelvin - 273.15)];
		};
		expect(at(morning)).toEqual([332, -51]);
		expect(at(evening)).toEqual([271, -47]);
	});
});

describe('the capture against the balloons', () => {
	// GNSS − baro samples at cruise, with the aircraft's own ADS-B position (230 of 243).
	const cruise = sky.columns.filter((c) => c.altitude > 30_000);
	const gap = (heights: 'ellipsoid' | 'sea level') =>
		cruise.map(
			(c) =>
				column(c, { qnh: QNH, heights }).geopotential -
				balloon(staticPressure(c.altitude), c.rx).height
		);

	test('GNSS heights put the pressure levels where the balloons found them, on average', () => {
		// Where the aircraft says it is (GNSS, minus the geoid, as geopotential) against how
		// high the balloon found the same pressure. No QNH or temperature involved.
		expect(cruise.length).toBe(243);
		const d = gap('ellipsoid');
		expect(Math.abs(mean(d))).toBeLessThan(5); // 0.4 ft
		expect(rms(d)).toBeLessThan(100); // 94 ft: see the next test

		// Heights taken as above sea level instead would be 137 ft too high on average: the
		// geoid here (41 m). So these aircraft send heights above the ellipsoid, as DO-260B
		// says, and the page's default is right.
		expect(mean(gap('sea level'))).toBeGreaterThan(130);
	});

	test('the scatter is the weather: the pressure surfaces slope down to the north', () => {
		// Fit gap = a + b · (km north of Lindenberg) + c · (km east). A westerly wind needs
		// pressure surfaces that drop towards the north (geostrophic balance: on the rotating
		// Earth, air flows along height contours, lower heights to the left). One balloon
		// can't see a slope; 16 aircraft spread over 250 km can.
		const pts = cruise
			.map((c, i) => ({ c, d: gap('ellipsoid')[i] }))
			.filter(({ c }) => c.position.from === 'ADS-B')
			.map(({ c, d }) => ({
				north: (c.position.lat - 52.21) * 111.2,
				east: (c.position.lon - 14.12) * 111.2 * Math.cos(52.21 * (Math.PI / 180)),
				d
			}));
		const [a, b, c] = leastSquares(
			pts.map((p) => [1, p.north / 100, p.east / 100]),
			pts.map((p) => p.d)
		);
		const residual = pts.map((p) => p.d - a - (b * p.north) / 100 - (c * p.east) / 100);
		expect(rms(residual)).toBeLessThan(45); // from 94 ft: most of the scatter was the slope
		expect(b).toBeLessThan(-100); // ft per 100 km north
		expect(b).toBeGreaterThan(-170);
		// What's left at Lindenberg: GNSS heights about 25 m low, 0.6 K of column at FL350.
		// Within what the aircraft's altimeters may be off (RVSM allows ±200 ft, most are
		// within ±50) and the balloons' own height error (about 10 m).
		expect(a).toBeLessThan(0);
		expect(a).toBeGreaterThan(-120);

		// The wind that balances this slope (geostrophic): g / f times the gradient, with f
		// the Coriolis parameter, 2Ω · sin(latitude). The balloons and aircraft measured 50–61
		// kt from 255–285°; real wind curving around a low is slower than this balance says.
		const f = 2 * 7.2921e-5 * Math.sin(52 * (Math.PI / 180));
		const g = 9.80665;
		const slope = { north: (b * FT) / 100_000, east: (c * FT) / 100_000 }; // m per m
		const geostrophic: Vector = {
			north: ((g / f) * slope.east) / (1852 / 3600),
			east: (-(g / f) * slope.north) / (1852 / 3600)
		};
		const from = (directionOf(geostrophic) + 180) % 360;
		expect(from).toBeGreaterThan(270);
		expect(from).toBeLessThan(310);
		expect(speedOf(geostrophic)).toBeGreaterThan(60);
		expect(speedOf(geostrophic)).toBeLessThan(90);
	});

	test('the geostrophic wind from the aircraft alone points the way the balloons drifted', () => {
		// geostrophic.ts: the same slope, from how GNSS − baro changes along each level
		// flight, without the balloons. Each aircraft's own altimeter error drops out.
		const g = geostrophicWind(sky.columns, { lat: 52, lon: 14 }, 'ellipsoid');
		if (!g.found) throw new Error(g.reason);
		expect(g.aircraft).toBe(9);
		expect(g.slope.north).toBeCloseTo(-142, -1); // the fit against the balloons: −137
		expect(g.residual).toBeLessThan(10); // ft: little more than the 25 ft steps
		// The balloons' mean wind over the same levels, FL350–FL390.
		const measured = meanWind(
			[morning, evening].flatMap((s) =>
				[35_000, 36_000, 37_000, 38_000, 39_000].map((l) => windOf(inLayer(s, l).wind))
			)
		)!;
		expect(Math.round(measured.direction)).toBe(266);
		expect(Math.round(measured.speed)).toBe(55);
		// 267°: within 1.3° of the balloons.
		expect(Math.abs(angleDifference(measured.direction, g.wind.direction))).toBeLessThan(2);
		// 72 kt, ± 6 leaving out any one aircraft: faster than the real 55 kt, as the
		// balance is where the air curves around a low.
		expect(g.wind.speed).toBeCloseTo(71.8, 1);
		expect(g.uncertainty).toBeLessThan(6);
	});

	test('the column temperature agrees within 0.8 K at every cruise layer, with the real QNH', () => {
		const time = mean(cruise.map((c) => c.rx));
		const k = (time - morning.launched) / (evening.launched - morning.launched);
		for (const l of all.filter((l) => l.column && l.column.n >= 20)) {
			const ours = column(l.column!, { qnh: QNH, heights: 'ellipsoid' }).isaDeviation;
			const theirs =
				balloonColumn(morning, l.column!.altitude) * (1 - k) +
				balloonColumn(evening, l.column!.altitude) * k;
			expect(Math.abs(ours - theirs)).toBeLessThan(0.8);
			// Assuming standard pressure, as the page has to without a local setting, makes
			// it 1.1–1.2 K colder: 6.25 hPa × 27 ft = 171 ft, against 139 ft per K at FL350
			// and 157 at FL390.
			const standard = column(l.column!, { qnh: 1013.25, heights: 'ellipsoid' }).isaDeviation;
			expect(ours - standard).toBeGreaterThan(1.05);
			expect(ours - standard).toBeLessThan(1.25);
		}
	});

	test('temperatures per aircraft: 2 K too cold on average, one 7 K', () => {
		// Each from TAS / Mach (observation.ts). In steady cruise neither changes, so an
		// aircraft's rounding (up to ±2.5 K) doesn't average out over its samples; nor do its
		// own probe's errors. The column above gets 0.4 K from GNSS heights: better than
		// any single aircraft's temperature here.
		const per = [...byAircraft(sky.temperatures)].map(([icao, ts]) => ({
			icao,
			off: mean(ts.map((t) => t.kelvin - balloon(staticPressure(t.altitude), t.rx).kelvin))
		}));
		expect(per.length).toBe(11);
		expect(mean(per.map((p) => p.off))).toBeCloseTo(-2.0, 1);
		const worst = per.reduce((a, b) => (b.off < a.off ? b : a));
		expect(worst).toMatchObject({ icao: '501C2B' });
		expect(worst.off).toBeCloseTo(-7.4, 1);
		// The rest within 4.2 K: three around −4 K, seven within 2 K.
		const rest = per.filter((p) => p !== worst).map((p) => Math.abs(p.off));
		expect(Math.max(...rest)).toBeLessThan(4.2);
		expect(rest.filter((x) => x < 2).length).toBe(7);
	});

	/**
	 * For each aircraft with at least 20 winds, the heading correction that best matches the
	 * balloons (0.25° steps), and the mean wind error before and after it, kt.
	 */
	let balloonHeadings: Map<string, { offset: number; before: number; after: number }> | undefined;
	function headingsFromBalloons() {
		if (balloonHeadings) return balloonHeadings;
		const trusted = observations.filter((o) => o.wind && !o.windProblem && o.inputs.altitude);
		balloonHeadings = new Map();
		for (const [icao, os] of byAircraft(trusted)) {
			if (os.length < 20) continue;
			const pairs = os.map((o) => ({
				o,
				truth: balloon(staticPressure(o.inputs.altitude!.feet), o.inputs.trackAndTurn.rx).wind
			}));
			const error = (degrees: number) =>
				mean(
					pairs.map(({ o, truth }) => {
						const w = o.wind!;
						const air = toVector(o.inputs.trackAndTurn.value.tas!, w.trueHeading + degrees);
						return Math.hypot(
							w.ground.north - air.north - truth.north,
							w.ground.east - air.east - truth.east
						);
					})
				);
			let best = 0;
			for (let d = -10; d <= 10; d += 0.25) if (error(d) < error(best)) best = d;
			balloonHeadings.set(icao, { offset: best, before: error(0), after: error(best) });
		}
		return balloonHeadings;
	}

	test('winds per aircraft: 6,0 headings are magnetic, but one is 3.5° off', () => {
		// The wind triangle (wind.ts) turns 6,0's magnetic heading into a true one with the
		// declination (5° here). For each aircraft, the heading correction that best matches
		// the balloons: near 0 means the heading and declination are right.
		const offsets = headingsFromBalloons();
		expect(offsets.size).toBe(9); // with at least 20 winds
		const odd = offsets.get('440822')!;
		expect(odd.offset).toBeGreaterThanOrEqual(-4.5);
		expect(odd.offset).toBeLessThanOrEqual(-3);
		expect(odd.before).toBeGreaterThan(25); // kt: the "83 kt" at FL350
		expect(odd.after).toBeLessThan(10);
		// The others within 2°. At 450 kt even that is up to 16 kt of crosswind: why a layer
		// wants several aircraft (MIN_AIRCRAFT).
		for (const [icao, o] of offsets)
			if (icao !== '440822') expect(Math.abs(o.offset)).toBeLessThan(2.1);
	});

	test('heading checks against the other aircraft find the same corrections', () => {
		// headings.ts, without the balloons: each aircraft's wind against the others'.
		const checks = headingChecks(sky.winds);
		const offsets = headingsFromBalloons();
		// Every aircraft with enough samples and others nearby (AE01D5 has 4 winds: too few).
		expect([...checks.keys()].sort()).toEqual(
			['3C65D4', '3C6750', '4400F8', '440822', '44CE75', '471D67', '4BAAC7', '501C2B'].sort()
		);
		// Within 2.2° of what the balloons say, for every one of them.
		for (const [icao, c] of checks)
			expect(Math.abs(c.correction - offsets.get(icao)!.offset)).toBeLessThan(2.3);
		// Only 440822 is clearly off (MIN_CORRECTION): −4.0°, the balloons say −3.5°.
		const off = [...checks.values()].filter((c) => c.significant);
		expect(off.map((c) => c.icao)).toEqual(['440822']);
		expect(off[0].correction).toBeCloseTo(-4.0, 1);
		expect(off[0].others).toBe(5);

		// Corrected, its layer (FL350) is 3 kt from the balloons instead of 29; the others
		// stay as they were.
		const error = (winds: typeof sky.winds) =>
			Object.fromEntries(
				layers([], winds, [])
					.filter((l) => l.wind)
					.map((l) => {
						const at = winds.filter((w) => Math.round(w.altitude / 1000) * 1000 === l.level);
						const t = balloon(staticPressure(l.level), mean(at.map((w) => w.rx))).wind;
						const v = l.wind!.wind.vector;
						return [
							l.level,
							Math.round(speedOf({ north: v.north - t.north, east: v.east - t.east }))
						];
					})
			);
		expect(error(sky.winds)).toEqual({
			34000: 34, // one sample from one aircraft
			35000: 29,
			36000: 2,
			37000: 4,
			38000: 12,
			39000: 10
		});
		expect(error(applyHeadingChecks(sky.winds, checks))).toEqual({
			...error(sky.winds),
			35000: 3
		});
	});

	test('the strongest wind and the tropopause, against the balloons', () => {
		// FL360, 59 kt from 275°, from two aircraft (MIN_AIRCRAFT keeps 440822's FL350 out).
		const w = strongestWind(all)!;
		expect(w.level).toBe(36_000);
		const truth = [morning, evening].map((s) => inLayer(s, 36_000).wind);
		for (const t of truth) {
			expect(Math.abs(speedOf(t) - w.wind.speed)).toBeLessThan(3); // 61 and 58 kt
		}
		// The balloons' tropopause (FL332, then FL271) is below every layer the aircraft
		// filled (FL360–FL380 with enough data): we can't see it, and don't claim to.
		const usable = all.filter((l) => enough(l.temperature)).map((l) => l.level);
		expect(usable).toEqual([36_000, 37_000, 38_000]);
		expect(tropopause(all).found).toBe(false);
	});

	test('contrails: the balloons say no at FL360–FL380, the aircraft are too cold to tell', () => {
		// Schmidt–Appleman (contrail.ts) with the balloons' own temperature and humidity,
		// interpolated to the middle of the capture. The radiosonde found the air very dry:
		// 0.010 g/kg of water, reported to 0.01 g/kg, so 6–9 % relative humidity over water.
		// Contrails there needed 31–46 %: none formed, whatever the engine.
		const time = CAPTURE_START + 5 * 60_000;
		const usable = all.filter((l) => enough(l.temperature));
		for (const l of usable) {
			const p = staticPressure(l.level);
			const [a, b] = [atPressure(morning, p), atPressure(evening, p)];
			const k = (time - a.time) / (b.time - a.time);
			const kelvin = a.kelvin + k * (b.kelvin - a.kelvin);
			const mixing = a.mixingRatio + k * (b.mixingRatio - a.mixingRatio);
			expect(humidityOf(mixing + 0.005e-3, p, kelvin)).toBeLessThan(0.1);
			const truth = contrail(kelvin, p);
			expect(truth.verdict).toBe('humid');
			expect(truth.humidityNeeded!).toBeGreaterThan(0.3);
			// One kelvin either way moves that by 20–25 points: the answer hinges on
			// the temperature far more finely than any single aircraft measures it.
			const colder = contrail(kelvin - 1, p).humidityNeeded!;
			const warmer = contrail(kelvin + 1, p).humidityNeeded!;
			expect(truth.humidityNeeded! - colder).toBeGreaterThan(0.2);
			expect(warmer - truth.humidityNeeded!).toBeGreaterThan(0.15);
		}
		// The aircraft's layers (2–4 aircraft each, 2 K cold on average, see above) put
		// FL360 and FL370 3–6 K colder than the balloons: "contrails in any air" there.
		// FL380, within 0.5 K, agrees: it depends on the humidity.
		const verdicts = usable.map((l) => contrail(l.temperature!.kelvin, staticPressure(l.level)));
		expect(verdicts.map((v) => v.verdict)).toEqual(['always', 'always', 'humid']);
	});
});

/** Least squares for a few unknowns: solves (XᵀX) β = Xᵀy by Gaussian elimination. */
function leastSquares(x: number[][], y: number[]): number[] {
	const n = x[0].length;
	const m = Array.from({ length: n }, (_, i) => [
		...Array.from({ length: n }, (_, j) => x.reduce((s, row) => s + row[i] * row[j], 0)),
		x.reduce((s, row, k) => s + row[i] * y[k], 0)
	]);
	for (let i = 0; i < n; i++) {
		for (let r = i + 1; r < n; r++) {
			const f = m[r][i] / m[i][i];
			for (let c = i; c <= n; c++) m[r][c] -= f * m[i][c];
		}
	}
	const beta = Array<number>(n).fill(0);
	for (let i = n - 1; i >= 0; i--) {
		let s = m[i][n];
		for (let c = i + 1; c < n; c++) s -= m[i][c] * beta[c];
		beta[i] = s / m[i][i];
	}
	return beta;
}
