/**
 * What /weather shows of an observation (lib/weather/observation.ts): the wind, the
 * temperature and the register values behind them, as Fields. Each tooltip carries the
 * calculation with this observation's own numbers, so any value can be checked by hand.
 *
 * And the tracker panel's "Weather where it flies" (weatherHereFields): the same, per
 * aircraft, in sentences (the panel's tooltips are paragraphs, and also for phones).
 */
import { compass } from '#lib/geo.ts';
import { A0, RHO0, T0 } from '#lib/modes/air-data.ts';
import {
	MAX_LEVEL_FT,
	MAX_TIME_MS,
	MIN_CORRECTION,
	turn,
	type HeadingCheck
} from '#lib/weather/headings.ts';
import { MAX_ROLL, MAX_SKEW_MS, STEP, type Observation } from '#lib/weather/observation.ts';
import { AVERAGE_MS, type WeatherAircraft } from '#lib/weather/tracker.ts';
import { components, normalise, windOf, type Vector, type Wind } from '#lib/weather/wind.ts';
import type { Field } from './field';

/** "070°": three digits, like on a chart or in a weather report. */
export const degrees = (x: number) => `${String(Math.round(x) % 360).padStart(3, '0')}°`;

/** −53.5 °C, with a real minus sign. */
export function celsius(kelvin: number, digits = 1): string {
	const c = kelvin - 273.15;
	const text = Math.abs(c).toFixed(digits);
	return `${c < 0 && Number(text) !== 0 ? '−' : ''}${text} °C`;
}

/**
 * "W  251° 57 kt": the 8-point compass direction first (padded, so columns line up in a
 * monospace font), then the exact one. Both say where the wind comes *from*.
 */
export const windText = (w: Wind) =>
	`${compass(w.direction).padEnd(2, '\u00a0')} ${degrees(w.direction)} ${Math.round(w.speed)} kt`;

/** Signed with a real minus: −0.2 */
export const signed = (x: number, digits = 1) =>
	`${x < 0 ? '−' : x > 0 ? '+' : ''}${Math.abs(x).toFixed(digits)}`;

/** "ISA +3": measured minus standard temperature, whole kelvin (= °C). */
export const isaText = (deviation: number) => `ISA ${signed(deviation, 0)}`;

/** "56 kt tailwind", "12 kt headwind" */
export const alongText = (tailwind: number) =>
	`${Math.abs(tailwind).toFixed(0)} kt ${tailwind >= 0 ? 'tailwind' : 'headwind'}`;

/** "11 kt crosswind from the right": positive crosswind pushes right, so comes from the left. */
export const acrossText = (crosswind: number) =>
	`${Math.abs(crosswind).toFixed(0)} kt crosswind from the ${crosswind >= 0 ? 'left' : 'right'}`;

/** "1.3° right" */
export const driftText = (drift: number) =>
	`${Math.abs(drift).toFixed(1)}° ${drift >= 0 ? 'right' : 'left'}`;

/** "1018.4 hPa", but the standard pressure as itself: "1013.25 hPa". */
export const hpa = (x: number) => `${x.toFixed(Math.round(x * 100) % 10 ? 2 : 1)} hPa`;

/** "FL370" above 18,000 ft (where everyone uses the standard pressure setting), else feet. */
export function flightLevel(feet: number): string {
	return feet >= 18_000
		? `FL${String(Math.round(feet / 100)).padStart(3, '0')}`
		: `${feet.toLocaleString()} ft`;
}

export function windFields(o: Observation): Field[] {
	if (!o.wind) return [{ value: '—', title: o.windProblem ?? '', tone: 'minor' }];
	const { wind, speedRange, directionSpread, declination, trueHeading, components: c } = o.wind;
	const { groundSpeed, track, tas } = o.inputs.trackAndTurn.value;
	const heading = o.inputs.headingAndSpeed.value.heading!;
	const title = [
		`Wind from ${wind.direction.toFixed(1)}° (${compass(wind.direction)}) at ${wind.speed.toFixed(1)} kt.`,
		'',
		`True heading = magnetic heading + declination = ${heading.toFixed(1)}° ${signed(declination)}° = ${trueHeading.toFixed(1)}°`,
		`Ground vector: ${groundSpeed} kt towards ${track!.toFixed(1)}° (5,0)`,
		`Air vector: ${tas} kt towards ${trueHeading.toFixed(1)}° (TAS from 5,0, heading from 6,0)`,
		`Wind = ground − air: ${wind.speed.toFixed(1)} kt towards ${((wind.direction + 180) % 360).toFixed(1)}°, so from ${wind.direction.toFixed(1)}°`,
		'',
		`For the aircraft: ${alongText(c.tailwind)}, ${acrossText(c.crosswind)}, drifting ${driftText(c.drift)}.`,
		'',
		`Rounding of the four inputs allows ${speedRange[0].toFixed(1)}–${speedRange[1].toFixed(1)} kt, ±${directionSpread.toFixed(1)}°.`
	].join('\n');
	const fields: Field[] = [
		{ value: windText(wind), title, tone: o.windProblem ? 'minor' : 'main', mono: true }
	];
	if (o.windProblem) fields.push(problemField(o.windProblem, 'wind'));
	else
		fields.push({
			value: `±${Math.max(Math.round((speedRange[1] - speedRange[0]) / 2), 1)}`,
			title: `From rounding alone: ${speedRange[0].toFixed(1)}–${speedRange[1].toFixed(1)} kt, direction ±${directionSpread.toFixed(1)}°. Heading errors (the aircraft's own magnetic variation table, compass calibration) come on top.`,
			tone: 'minor'
		});
	return fields;
}

export function temperatureFields(o: Observation): Field[] {
	if (!o.temperature) return [{ value: '—', title: o.temperatureProblem ?? '', tone: 'minor' }];
	const { kelvin, speedOfSound, range, total, atAltitude: at } = o.temperature;
	const tas = o.inputs.trackAndTurn.value.tas!;
	const mach = o.inputs.headingAndSpeed.value.mach!;
	const title = [
		`Static air temperature ${celsius(kelvin, 2)} (${kelvin.toFixed(2)} K).`,
		'',
		`Speed of sound a = TAS / Mach = ${tas} kt / ${mach.toFixed(3)} = ${speedOfSound.toFixed(1)} kt`,
		`a = ${A0.toFixed(2)} kt × √(T / ${T0} K), so`,
		`T = ${T0} K × (${speedOfSound.toFixed(1)} / ${A0.toFixed(2)})² = ${kelvin.toFixed(1)} K`,
		'',
		...(at
			? [
					`Standard atmosphere at this altitude: ${celsius(at.isa)}, so ${isaText(at.isaDeviation)} (${at.isaDeviation >= 0 ? 'warmer' : 'colder'} than standard).`,
					`Air density ${at.density.toFixed(3)} kg/m³ (${((at.density / RHO0) * 100).toFixed(0)} % of sea level), density altitude ${Math.round(at.densityAltitude).toLocaleString()} ft.`
				]
			: ['No altitude: no comparison with the standard atmosphere.']),
		`The temperature probe reads ${celsius(total)} (total air temperature: warmed by stopping the air).`,
		'',
		`Rounding (TAS ±${STEP.speed / 2} kt, Mach ±${STEP.mach / 2}) allows ${celsius(range[0])} to ${celsius(range[1])}.`
	].join('\n');
	const fields: Field[] = [
		{ value: celsius(kelvin), title, tone: o.temperatureProblem ? 'minor' : 'main' }
	];
	if (o.temperatureProblem) fields.push(problemField(o.temperatureProblem, 'temperature'));
	else
		fields.push({
			value: `±${((range[1] - range[0]) / 2).toFixed(1)}`,
			title: `From rounding alone: ${celsius(range[0])} to ${celsius(range[1])}`,
			tone: 'minor'
		});
	return fields;
}

function problemField(problem: string, what: string): Field {
	return { value: 'not used', title: `This ${what} isn't trusted: ${problem}`, tone: 'alert' };
}

/** The checks: time between the two replies and the bank angle. */
export function checkFields(o: Observation): Field[] {
	const { roll, trackRate } = o.inputs.trackAndTurn.value;
	const skewOk = o.skewMs <= MAX_SKEW_MS;
	const fields: Field[] = [
		{
			label: 'Δt',
			value: o.skewMs < 1000 ? `${Math.round(o.skewMs)} ms` : `${(o.skewMs / 1000).toFixed(1)} s`,
			title: `Time between the 5,0 and the 6,0 reply (receiver clock). At most ${MAX_SKEW_MS / 1000} s, so both describe the same moment.`,
			tone: skewOk ? 'minor' : 'alert'
		}
	];
	if (roll !== null)
		fields.push({
			label: 'bank',
			value: `${Math.abs(roll).toFixed(1)}°`,
			title: `Roll angle from 5,0${roll > 0 ? ' (right wing down)' : roll < 0 ? ' (left wing down)' : ''}. More than ${MAX_ROLL}° and the aircraft is turning: its heading changes too fast for the wind triangle (the temperature doesn't mind).`,
			tone: Math.abs(roll) > MAX_ROLL ? 'alert' : 'minor'
		});
	else if (trackRate !== null)
		fields.push({
			label: 'turn',
			value: `${trackRate.toFixed(2)}°/s`,
			title: '5,0 has no roll angle, so its track rate decides whether the aircraft is turning',
			tone: o.windProblem?.startsWith('turning') ? 'alert' : 'minor'
		});
	return fields;
}

/** The register values that go into the calculation. */
export function inputFields(o: Observation): Field[] {
	const { groundSpeed, track, tas } = o.inputs.trackAndTurn.value;
	const { heading, mach } = o.inputs.headingAndSpeed.value;
	const f = (label: string, value: string | null, title: string): Field[] =>
		value === null ? [] : [{ label, value, title, tone: 'minor' }];
	return [
		...f('GS', groundSpeed === null ? null : `${groundSpeed}`, 'Ground speed, kt (5,0)'),
		...f('TRK', track === null ? null : degrees(track), `True track: ${track?.toFixed(2)}° (5,0)`),
		...f('TAS', tas === null ? null : `${tas}`, 'True airspeed, kt (5,0)'),
		...f(
			'HDG',
			heading === null ? null : degrees(heading),
			`Magnetic heading: ${heading?.toFixed(2)}° (6,0)${o.wind ? `; true ${o.wind.trueHeading.toFixed(2)}° with the declination of ${signed(o.wind.declination, 2)}°` : ''}`
		),
		...f('M', mach === null ? null : mach.toFixed(3), 'Mach number (6,0)')
	];
}

/** "4 s ago", "2 min ago" (as describe/aircraft.ts's). */
function ago(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	return s < 120 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
}

/** Whole numbers with thousands separators. */
const whole = (x: number) => Math.round(x).toLocaleString('en');

/**
 * The tracker panel's weather section for one aircraft (lib/weather/tracker.ts): its wind,
 * what that means for it, the heading check against the others, its temperature. Empty if
 * it has none: then no radar here reads its registers 5,0 and 6,0.
 */
export function weatherHereFields(
	w: WeatherAircraft,
	check: HeadingCheck | null,
	now: number
): (Field & { label: string })[] {
	const fields: (Field & { label: string })[] = [];
	const minute = `${AVERAGE_MS / 60_000} min`;

	// --- wind ----------------------------------------------------------------------------
	const o = w.lastWind;
	if (o?.wind) {
		const { wind, trueHeading, declination, speedRange, ground, air } = o.wind;
		const { groundSpeed, track, tas } = o.inputs.trackAndTurn.value;
		const heading = o.inputs.headingAndSpeed.value.heading!;
		// A heading clearly off (headings.ts) is corrected, as on the map and on /weather:
		// ground − the air vector turned by the correction.
		const correction = check?.significant ? check.correction : 0;
		const fix = (g: Vector, a: Vector) => {
			const turned = turn(a, correction);
			return windOf({ north: g.north - turned.north, east: g.east - turned.east });
		};
		const latest = correction ? fix(ground, air) : wind;
		const { average } = w;
		const mean =
			average.windCount > 1 && average.wind && average.air
				? correction
					? fix(
							{
								north: average.wind.vector.north + average.air.north,
								east: average.wind.vector.east + average.air.east
							},
							average.air
						)
					: average.wind
				: null;
		const shown = mean ?? latest;
		const level = o.inputs.altitude ? ` at ${flightLevel(o.inputs.altitude.feet)}` : '';
		fields.push({
			label: 'Wind',
			value: `${compass(shown.direction)} ${degrees(shown.direction)} · ${Math.round(shown.speed)} kt`,
			title: `Where the wind comes from (degrees from true north) and how fast${level}, worked out from its own registers${
				mean ? `: the mean of its ${average.windCount} readings in the last ${minute}` : ''
			}. Nobody sends a wind: it's the wind triangle. Over the ground the aircraft makes ${groundSpeed} kt along ${track!.toFixed(1)}° (register 5,0); through the air ${tas} kt along its heading, ${heading.toFixed(1)}° magnetic (6,0) + ${signed(declination)}° declination = ${trueHeading.toFixed(1)}° true${
				correction
					? `, ${signed(correction)}° heading correction (below) = ${normalise(trueHeading + correction).toFixed(1)}°`
					: ''
			}. The difference between the two is the air moving: ${Math.round(latest.speed)} kt from ${degrees(latest.direction)} in the latest reading, ${ago(now - o.rx)}. The registers' rounding alone allows ±${Math.max(1, Math.round((speedRange[1] - speedRange[0]) / 2))} kt.`,
			tone: 'main'
		});
		const c = components(latest, trueHeading + correction, track!);
		fields.push({
			label: 'For it',
			value: `${alongText(c.tailwind)} · ${driftText(c.drift)} drift`,
			title: `The wind split along and across the nose, in the latest reading. ${
				c.tailwind >= 0
					? `A tailwind: it makes ${Math.round(c.tailwind)} kt more over the ground than through the air, which shortens the flight.`
					: `A headwind: it makes ${Math.round(-c.tailwind)} kt less over the ground than through the air, which costs time and fuel.`
			} The ${acrossText(c.crosswind)} makes it crab: the nose points ${Math.abs(c.drift).toFixed(1)}° ${c.drift >= 0 ? 'left' : 'right'} of the track.`,
			tone: 'main'
		});
		if (check) {
			const asSent = mean ? average.wind! : wind;
			fields.push({
				label: 'Heading check',
				value: correction
					? `${Math.abs(correction).toFixed(1)}° off, corrected (as sent: ${Math.round(asSent.speed)} kt)`
					: `agrees with ${check.others} others`,
				title: `Its wind compared with ${check.others} other aircraft's within ${MAX_LEVEL_FT.toLocaleString('en')} ft and ${MAX_TIME_MS / 60_000} min. Each degree of heading error turns the air vector and makes ${whole(tas! * Math.sin(Math.PI / 180))} kt of crosswind that isn't there, so a heading that's off shows as a wind that disagrees with everyone else's. ${
					correction
						? `Its heading looks ${Math.abs(correction).toFixed(1)}° too far ${correction > 0 ? 'left' : 'right'}: the others' wind fits best with it turned ${correction > 0 ? 'right' : 'left'}, off by ${whole(check.before)} kt on average as sent, ${whole(check.after)} kt corrected. Why it can be: an old magnetic variation table in its navigation database, or a compass out of calibration. So the wind above, the barbs on the map and the profile on /weather use the corrected heading; as sent, its wind would be ${Math.round(asSent.speed)} kt from ${degrees(asSent.direction)}.`
						: `It fits best with its heading turned ${signed(check.correction)}°: less than the ${MIN_CORRECTION}° the check can tell from the others' own errors and the wind changing from place to place, so it's used as sent.`
				}`,
				tone: correction ? 'alert' : 'minor'
			});
		}
	} else if (w.latest.windProblem) {
		fields.push({
			label: 'Wind',
			value: 'not now',
			title: `Its registers 5,0 and 6,0 come in, but the latest pair doesn't give a wind to trust: ${w.latest.windProblem}. The wind triangle needs the heading and the track from the same moment, in straight flight.`,
			tone: 'minor'
		});
	}

	// --- temperature ---------------------------------------------------------------------
	const t = w.lastTemperature;
	if (t?.temperature) {
		const averaged = w.average.temperatureCount > 1 ? w.average.kelvin : null;
		const kelvin = averaged ?? t.temperature.kelvin;
		const deviation =
			(w.average.isaCount > 1 ? w.average.isaDeviation : null) ??
			t.temperature.atAltitude?.isaDeviation ??
			null;
		const { tas } = t.inputs.trackAndTurn.value;
		const mach = t.inputs.headingAndSpeed.value.mach!;
		fields.push({
			label: 'Outside air',
			value: `${celsius(kelvin)}${deviation === null ? '' : ` · ${isaText(deviation)}`}`,
			title: `The temperature of the air it flies through${
				averaged === null
					? ''
					: ` (the mean of the last ${minute}: ${w.average.temperatureCount} readings)`
			}. Not sent: true airspeed (5,0) / Mach (6,0) = the speed of sound, which depends only on the temperature (${tas} kt / ${mach.toFixed(3)} = ${t.temperature.speedOfSound.toFixed(0)} kt in the latest reading). ${
				deviation !== null
					? `The standard atmosphere has ${celsius(kelvin - deviation)} here, so the air is ${Math.abs(deviation).toFixed(0)} K ${deviation >= 0 ? 'warmer' : 'colder'} than standard (ISA ${signed(deviation, 0)}). Warmer air is thinner: the engines give less thrust and the wings less lift.`
					: ''
			} Its probe reads ${celsius(t.temperature.total)}: the air warms as it's stopped in front of it.`,
			tone: 'main'
		});
	}
	return fields;
}
