/**
 * A radar's rotation period, from the bursts of replies it gets (bursts.ts).
 *
 * A rotating secondary radar interrogates an aircraft only while its beam (about 2.4° wide)
 * points at it: at 12 rpm that's ~30 ms per turn, enough for a few replies. So the
 * replies to one radar come in bursts, one per turn of the antenna, and the time between
 * an aircraft's bursts is a whole number of turns: one, or more when a turn brought no
 * reply we heard (the reply was too weak, or garbled by another one). In the capture:
 *
 *     SI44, 440822:   5.02  9.93  5.04  9.97  5.01  4.95  4.98 …   → 5.00 s, 12 rpm
 *
 * The period is the one that fits all those gaps at once: for a candidate P, every gap d
 * scores cos(2π d / P), 1 for a whole number of turns, −1 for half a turn off. Gaps that are
 * a whole number of turns of P are also whole numbers of turns of P/2, P/3 …, so those
 * score just as well; the period is the longest candidate scoring near the best. Typical
 * periods: 4–5 s for approach radars (12–15 rpm), 8–12 s for long-range en-route ones
 * (5–7.5 rpm), Eurocontrol's Radar Surveillance Standard (2.3) and the ICAO Manual on
 * the Secondary Surveillance Radar (Doc 9684, 3.1).
 *
 * Only the start: resection.ts refits the period with the position, to a fraction of a
 * millisecond over many turns.
 */

/** Gaps between an aircraft's bursts considered, s: shorter is the same turn, longer too vague. */
export const MIN_GAP_S = 1.5;
export const MAX_GAP_S = 60;
/** Periods searched, s: from the fastest radars (15 rpm, and twice that for safety) to 3 rpm. */
export const MIN_PERIOD_S = 2;
export const MAX_PERIOD_S = 20;
/** A shorter candidate wins only if it scores at least this share of the best. */
const NEAR_BEST = 0.8;
/** Each burst is compared with its next few, not with all of them: enough, and cheap. */
const NEIGHBOURS = 4;
/** The coarse scan scores at most this many gaps. */
const COARSE_SAMPLE = 250;
/** sharpComb's κ. */
const SHARPNESS = 10;

/** The gaps between each aircraft's bursts (times in s, each aircraft's in order). */
export function gaps(byAircraft: number[][]): number[] {
	const out: number[] = [];
	for (const times of byAircraft)
		for (let i = 0; i < times.length; i++)
			for (let j = i + 1; j <= i + NEIGHBOURS && j < times.length; j++) {
				const d = times[j] - times[i];
				if (d > MAX_GAP_S) break;
				if (d >= MIN_GAP_S) out.push(d);
			}
	return out;
}

/** How well every gap is a whole number of turns of `period`: 1 if all, ~0 if unrelated. */
export function comb(gapsS: number[], period: number): number {
	let sum = 0;
	for (const d of gapsS) sum += Math.cos((2 * Math.PI * d) / period);
	return gapsS.length ? sum / gapsS.length : 0;
}

/**
 * Like comb, but only gaps within a few percent of a turn count (a von Mises kernel,
 * e^(κ(cos θ − 1)), κ = SHARPNESS: half its height at ±0.06 turns). The cosine of comb lets
 * every gap pull: with two radars on one code, the gaps from one radar's bursts to the
 * other's (always the same fraction of a turn apart) shift the peak by ~10 ms, which over
 * 60 turns adds up to half a second. Here they count as nothing.
 */
function sharpComb(gapsS: number[], period: number): number {
	let sum = 0;
	for (const d of gapsS) sum += Math.exp(SHARPNESS * (Math.cos((2 * Math.PI * d) / period) - 1));
	return gapsS.length ? sum / gapsS.length : 0;
}

export interface PeriodEstimate {
	/** s */
	period: number;
	/** Its score (comb, or sharpComb inside), 0–1. */
	score: number;
}

/** The best period within ±width of `around` by sharpComb, in steps; and its score. */
function sharpest(gapsS: number[], around: number, width: number, step: number): PeriodEstimate {
	let best = { period: around, score: -1 };
	for (let p = around - width; p <= around + width; p += step) {
		const score = sharpComb(gapsS, p);
		if (score > best.score) best = { period: p, score };
	}
	return best;
}

/** sharpest, twice: within `share` of `around` in 1 ms steps, then within 1 ms in 0.05 ms. */
function place(gapsS: number[], around: number, share: number): PeriodEstimate {
	const rough = sharpest(gapsS, around, share * around, 0.001);
	return sharpest(gapsS, rough.period, 0.001, 0.00005);
}

/**
 * The rotation period that explains the gaps best, or null without enough gaps. A coarse
 * scan with comb (5 ms steps) finds the peak; sharpComb places it (within 2 %, then within
 * 1 ms), and then decides between it and its multiples: with two radars on one code half
 * a turn apart, every gap is a whole number of half turns, and comb prefers the half. A
 * multiple wins if sharpComb still scores it near the best; for one radar, twice its
 * period misses every other turn's gaps, so it can't.
 */
export function estimatePeriod(gapsS: number[]): PeriodEstimate | null {
	if (gapsS.length < 10) return null;
	// Coarse: score every 5 ms. Peaks are ~P²/(2 × span of the gaps) wide: for 5 s and 60 s
	// gaps, 200 ms, so 5 ms steps can't miss one. A sample of the gaps is enough for that.
	const STEP = 0.005;
	const few =
		gapsS.length <= COARSE_SAMPLE
			? gapsS
			: Array.from(
					{ length: COARSE_SAMPLE },
					(_, i) => gapsS[Math.floor((i * gapsS.length) / COARSE_SAMPLE)]
				);
	const scores: number[] = [];
	for (let p = MIN_PERIOD_S; p <= MAX_PERIOD_S; p += STEP) scores.push(comb(few, p));
	const best = Math.max(...scores);
	if (best <= 0) return null;
	const peaks: number[] = [];
	for (let i = 1; i < scores.length - 1; i++)
		if (scores[i] >= NEAR_BEST * best && scores[i] >= scores[i - 1] && scores[i] > scores[i + 1])
			peaks.push(MIN_PERIOD_S + i * STEP);
	// The longest one: the shorter ones are fractions of it.
	const base = place(gapsS, peaks.at(-1) ?? MIN_PERIOD_S + scores.indexOf(best) * STEP, 0.02);
	let chosen = base;
	for (let k = 2; k * base.period <= MAX_PERIOD_S; k++) {
		const multiple = place(gapsS, k * base.period, 0.005);
		if (multiple.score >= NEAR_BEST * base.score) chosen = multiple;
	}
	return { period: chosen.period, score: comb(gapsS, chosen.period) };
}
