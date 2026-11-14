/**
 * Heading checks: each aircraft's wind against the other aircraft's at the same level and
 * time, and the heading correction that would make them agree.
 *
 * The wind triangle (wind.ts) takes the air vector (TAS along the heading) off the ground
 * vector. The ground vector comes from GNSS and is good to a knot; the heading comes from
 * the aircraft's compass system and is magnetic (register 6,0), turned true with the
 * declination. If an aircraft's heading is δ off, its air vector is turned by δ and its
 * wind gets a crosswind error of TAS · sin δ: 8 kt per degree at 450 kt. Compared with
 * weather balloons, most aircraft in the capture were within 2°, one 3.5° off: 29 kt
 * (sounding.test.ts). Why one would be: an old magnetic variation table in its navigation
 * database, a compass system out of calibration, a heading that's really a track.
 *
 * If the air is the same for everyone nearby, the others' winds say what this aircraft's
 * wind should be. Ground − that wind is the air vector it should have flown; the angle
 * from its reported air vector to that one is the heading error. Over many samples the
 * best angle has a closed form (least squares for a rotation): the direction of the sum
 * of TAS · |implied| · (cos, sin) of each sample's angle.
 *
 * The others are checked the same way, so their corrections go into the reference too;
 * a few rounds settle it. An aircraft needs at least MIN_OTHERS other aircraft to compare
 * with, so it's never one against one (who'd be wrong?). Each other aircraft counts once,
 * however many samples it has.
 *
 * Limits: it assumes the wind is the same everywhere the aircraft are within MAX_LEVEL_FT
 * and MAX_TIME_MS, up to 200 km apart; near a jet stream it isn't quite, and that shows
 * up as a heading error. And it can't see an error everyone shares.
 *
 * Shared by server and browser; no state here.
 */
import { MIN_SAMPLES, type WindSample } from './profile';
import { speedOf, type Vector } from './wind';

/** Other aircraft count as "nearby" within this many feet … */
export const MAX_LEVEL_FT = 2000;
/** … and minutes. */
export const MAX_TIME_MS = 15 * 60_000;
/** At least this many other aircraft to compare with. */
export const MIN_OTHERS = 2;
/**
 * Corrections smaller than this, degrees, aren't applied: the method can't tell them from
 * the others' own errors and the wind changing from place to place. Against the capture's
 * weather balloons it agreed within 2.2° for every aircraft (sounding.test.ts); 3° is 24 kt
 * of crosswind at 450 kt.
 */
export const MIN_CORRECTION = 3;
const ROUNDS = 5;
const RAD = Math.PI / 180;

export interface HeadingCheck {
	icao: string;
	/** Degrees to add to the heading, clockwise. */
	correction: number;
	/** Own samples that had others to compare with. */
	samples: number;
	/** Different other aircraft compared with. */
	others: number;
	/** Mean difference to the others' wind, kt: as sent, and corrected. */
	before: number;
	after: number;
	/** Mean TAS · sin(correction), kt: the crosswind the correction removes. */
	crosswind: number;
	/** At least MIN_CORRECTION: clearly off, and corrected. */
	significant: boolean;
}

/** A vector turned clockwise (like a heading) by `degrees`. */
export function turn(v: Vector, degrees: number): Vector {
	const c = Math.cos(degrees * RAD);
	const s = Math.sin(degrees * RAD);
	return { north: v.north * c - v.east * s, east: v.north * s + v.east * c };
}

/** The wind with the heading turned by `degrees`: ground − turned air. */
export function correctedWind(w: WindSample, degrees: number): Vector {
	if (!w.air) return w.wind; // from a turn: no heading in it
	const ground = { north: w.wind.north + w.air.north, east: w.wind.east + w.air.east };
	const air = turn(w.air, degrees);
	return { north: ground.north - air.north, east: ground.east - air.east };
}

/** Samples are grouped into cells of one layer and TIME_BIN_MS, for finding neighbours fast. */
const TIME_BIN_MS = 5 * 60_000;
const LEVELS = Math.round(MAX_LEVEL_FT / 1000);
const BINS = Math.round(MAX_TIME_MS / TIME_BIN_MS);
const cellOf = (w: WindSample) => ({
	level: Math.round(w.altitude / 1000),
	bin: Math.floor(w.rx / TIME_BIN_MS)
});

/** Per cell, per aircraft: the sum of its (corrected) winds and how many. */
type Cells = Map<string, Map<string, { north: number; east: number; n: number }>>;

function cells(winds: WindSample[], corrections: Map<string, number>): Cells {
	const out: Cells = new Map();
	for (const w of winds) {
		const { level, bin } = cellOf(w);
		const key = `${level} ${bin}`;
		let cell = out.get(key);
		if (!cell) out.set(key, (cell = new Map()));
		let sum = cell.get(w.icao);
		if (!sum) cell.set(w.icao, (sum = { north: 0, east: 0, n: 0 }));
		const v = correctedWind(w, corrections.get(w.icao) ?? 0);
		sum.north += v.north;
		sum.east += v.east;
		sum.n++;
	}
	return out;
}

/**
 * The other aircraft's mean wind near a sample (within LEVELS layers and BINS time bins:
 * about MAX_LEVEL_FT and MAX_TIME_MS), each aircraft once.
 */
function referenceWind(w: WindSample, grid: Cells): { wind: Vector; aircraft: string[] } | null {
	const { level, bin } = cellOf(w);
	const sums = new Map<string, { north: number; east: number; n: number }>();
	for (let l = level - LEVELS; l <= level + LEVELS; l++)
		for (let b = bin - BINS; b <= bin + BINS; b++) {
			const cell = grid.get(`${l} ${b}`);
			if (!cell) continue;
			for (const [icao, c] of cell) {
				if (icao === w.icao) continue;
				const sum = sums.get(icao) ?? { north: 0, east: 0, n: 0 };
				sums.set(icao, { north: sum.north + c.north, east: sum.east + c.east, n: sum.n + c.n });
			}
		}
	if (sums.size === 0) return null;
	let north = 0;
	let east = 0;
	for (const s of sums.values()) {
		north += s.north / s.n;
		east += s.east / s.n;
	}
	return { wind: { north: north / sums.size, east: east / sums.size }, aircraft: [...sums.keys()] };
}

/** Every aircraft that could be checked, by address. */
export function headingChecks(winds: WindSample[]): Map<string, HeadingCheck> {
	const byAircraft = Map.groupBy(winds, (w) => w.icao);
	let corrections = new Map<string, number>();
	let checks = new Map<string, HeadingCheck>();

	for (let round = 0; round < ROUNDS; round++) {
		const grid = cells(winds, corrections);
		const next = new Map<string, number>();
		checks = new Map();
		for (const [icao, all] of byAircraft) {
			// Winds from turns have no heading to check, but they're good references.
			const own = all.filter((w): w is WindSample & { air: Vector } => w.air !== null);
			if (own.length < MIN_SAMPLES) continue;
			const others = new Set<string>();
			let cos = 0;
			let sin = 0;
			const pairs: { w: WindSample & { air: Vector }; reference: Vector }[] = [];
			for (const w of own) {
				const reference = referenceWind(w, grid);
				if (!reference) continue;
				for (const o of reference.aircraft) others.add(o);
				// The air vector the others' wind implies, against the one reported.
				const implied = {
					north: w.wind.north + w.air.north - reference.wind.north,
					east: w.wind.east + w.air.east - reference.wind.east
				};
				cos += w.air.north * implied.north + w.air.east * implied.east;
				sin += w.air.north * implied.east - w.air.east * implied.north;
				pairs.push({ w, reference: reference.wind });
			}
			if (others.size < MIN_OTHERS || pairs.length < MIN_SAMPLES) continue;
			const correction = Math.atan2(sin, cos) / RAD;
			next.set(icao, correction);
			const off = (degrees: number) =>
				pairs.reduce((s, { w, reference }) => {
					const v = correctedWind(w, degrees);
					return s + speedOf({ north: v.north - reference.north, east: v.east - reference.east });
				}, 0) / pairs.length;
			checks.set(icao, {
				icao,
				correction,
				samples: pairs.length,
				others: others.size,
				before: off(0),
				after: off(correction),
				crosswind:
					(pairs.reduce((s, { w }) => s + speedOf(w.air), 0) / pairs.length) *
					Math.sin(correction * RAD),
				significant: Math.abs(correction) >= MIN_CORRECTION
			});
		}
		corrections = next;
	}
	return checks;
}

/** The wind samples with the heading corrected where it's clearly off (`significant`). */
export function applyHeadingChecks(
	winds: WindSample[],
	checks: Map<string, HeadingCheck>
): WindSample[] {
	return winds.map((w) => {
		const c = checks.get(w.icao);
		return c?.significant && w.air
			? { ...w, wind: correctedWind(w, c.correction), air: turn(w.air, c.correction) }
			: w;
	});
}
