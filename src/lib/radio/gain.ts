/**
 * Is the gain right? Advice for `--gain`, from the noise and from clipped messages.
 *
 * The dongle's ADC has 8 bits per sample (I and Q): 256 levels, about 48 dB between one step
 * and full scale. The gain decides where in that range the sky lands:
 *
 *   full scale ┬─────────────────────  strong messages: too much gain and they hit the top
 *              │                       and get cut off (clipped), the tuner overloads too
 *              │   messages
 *              │
 *   noise  ────┼─────────────────────  the noise: should be at least about one step high,
 *   one step ──┴─────────────────────  or the rounding to whole steps adds noise of its own
 *
 * - Too low: rounding to whole steps adds noise of 1/12 step² (a uniform error of ±½ step)
 *   per component. Against noise of σ steps that costs 10·log₁₀(1 + 1/(12σ²)) dB of
 *   signal-to-noise: 0.35 dB at σ = 1, 1 dB at σ = 0.57, 2.9 dB at σ = 0.3. We can't see σ
 *   directly, only the mean magnitude of the samples (the demodulator's level), so NOISE
 *   maps one to the other.
 * - Too high: messages that reach the ADC's limit (lib/demod ADC_LIMIT). A few are fine (an
 *   aircraft passing close by); many mean the strongest pulses get flattened, and the tuner
 *   itself works outside its linear range, with all its intermodulation.
 *
 * MAX_CLIPPED and MAX_ROUNDING_DB are first guesses (Nov 2026). A sweep with real traffic
 * (tools/gain-sweep.ts, 18 Nov 2026, 29.7–49.6 dB in 5 s steps, each against its own round's
 * mean) found nothing to move them on:
 *
 * - More gain heard more all the way up, 48.0 and 49.6 dB the same: the default stays 49.6.
 * - The rounding limit is on the cautious side. "Too low" starts at 43.4 dB and below,
 *   which do lose 12 % and more. But 44.5 dB (−41.2 dBFS, "fine") still heard ~14 % less
 *   than 48–49.6: more gain keeps helping after rounding stops mattering, probably
 *   because the tuner's own noise figure gets better with more LNA gain. One evening and one
 *   antenna: not enough to move the limit.
 * - Clipping: see MAX_CLIPPED.
 */

/**
 * Gain steps in dB per tuner, as librtlsdr sets them (rtl_tcp says the R820T has 29). The
 * R828D (RTL-SDR Blog V4) has the R820T's. Other tuners: no steps, advice by direction only.
 */
export const GAIN_STEPS: Record<string, readonly number[]> = {
	'Rafael Micro R820T': R82XX(),
	'Rafael Micro R828D': R82XX(),
	'Elonics E4000': [-1, 1.5, 4, 6.5, 9, 11.5, 14, 16.5, 19, 21.5, 24, 29, 34, 42]
};

function R82XX(): number[] {
	return [
		0, 0.9, 1.4, 2.7, 3.7, 7.7, 8.7, 12.5, 14.4, 15.7, 16.6, 19.7, 20.7, 22.9, 25.4, 28, 29.7, 32.8,
		33.8, 36.4, 37.2, 38.6, 40.2, 42.1, 43.4, 43.9, 44.5, 48, 49.6
	];
}

/**
 * Gaussian noise of σ ADC steps (on I and on Q), rounded to the dongle's 8 bits, and the mean
 * magnitude that gives in dBFS, the way the demodulator measures it. Simulated (400,000
 * samples each). Below 0.2 steps it hardly moves: −45 dBFS is what 127.5 between two codes
 * leaves even without any noise.
 */
const NOISE: readonly [sigma: number, dbfs: number][] = [
	[0.2, -45.0],
	[0.3, -44.1],
	[0.4, -43.0],
	[0.5, -42.2],
	[0.6, -41.5],
	[0.7, -40.8],
	[0.8, -40.1],
	[1, -38.7],
	[1.2, -37.5],
	[1.5, -35.9],
	[2, -33.6],
	[3, -30.3],
	[4, -27.9],
	[8, -21.9]
];

/** The noise's σ in ADC steps, from its mean magnitude in dBFS (NOISE, interpolated). */
export function noiseSigma(dbfs: number): number {
	if (dbfs <= NOISE[0][1]) return NOISE[0][0];
	for (let k = 1; k < NOISE.length; k++) {
		const [s1, d1] = NOISE[k];
		if (dbfs <= d1) {
			const [s0, d0] = NOISE[k - 1];
			return s0 + ((s1 - s0) * (dbfs - d0)) / (d1 - d0);
		}
	}
	// Past the table: the magnitude grows with σ (6 dB per doubling).
	const [s, d] = NOISE.at(-1)!;
	return s * 10 ** ((dbfs - d) / 20);
}

/** The other way: the mean magnitude in dBFS that noise of σ steps gives (NOISE). */
export function noiseDbfs(sigma: number): number {
	if (sigma <= NOISE[0][0]) return NOISE[0][1];
	for (let k = 1; k < NOISE.length; k++) {
		const [s1, d1] = NOISE[k];
		if (sigma <= s1) {
			const [s0, d0] = NOISE[k - 1];
			return d0 + ((d1 - d0) * (sigma - s0)) / (s1 - s0);
		}
	}
	const [s, d] = NOISE.at(-1)!;
	return d + 20 * Math.log10(sigma / s);
}

/** What rounding to whole ADC steps costs in signal-to-noise against noise of σ steps, dB. */
export function roundingCostDb(sigma: number): number {
	return 10 * Math.log10(1 + 1 / (12 * sigma * sigma));
}

/**
 * More than this share of messages clipped: the gain is too high.
 *
 * TODO: check it at a time with more strong traffic. Nothing clipped in the gain sweep;
 * afterwards one close aircraft reached full scale and clipped 42 messages in 5 s at 49.6 dB
 * (3.4 % of that step), too little to say whether 1 % over 5 minutes is the right limit.
 */
export const MAX_CLIPPED = 0.01;
/** Rounding costing more than this: the gain is too low… */
export const MAX_ROUNDING_DB = 1;
/** The noise level below which rounding costs more than MAX_ROUNDING_DB, dBFS (−41.7). */
export const ROUNDING_LIMIT_DBFS = noiseDbfs(
	1 / Math.sqrt(12 * (10 ** (MAX_ROUNDING_DB / 10) - 1))
);
/** …unless more than this share clips already: then the 8 bits are just too few. */
const CLIPPED_FOR_RAISE = MAX_CLIPPED / 4;
/** Clipping is judged from this many messages on. */
export const MIN_MESSAGES = 200;
/** A suggested step is about this far from the current gain, dB. */
const STEP_DB = 3;

export interface GainInput {
	/** The tuner (DeviceInfo.tuner): its steps, if known. */
	tuner: string | null;
	/** The gain now, dB; null: unknown (a recording). */
	gain: number | null;
	/** Mean noise level, dBFS; null: not measured. */
	noise: number | null;
	/** Messages demodulated, and how many of them clipped. */
	messages: number;
	clipped: number;
}

export type GainAdvice = {
	/** Noise in ADC steps, and what rounding costs (null without a noise level). */
	sigma: number | null;
	roundingDb: number | null;
	/** Share of messages clipped; null: too few messages to say. */
	clippedShare: number | null;
} & (
	| { verdict: 'unknown' }
	| { verdict: 'fine' }
	/** `suggest`: a gain to try (a step of this tuner), null if none: lowest step already. */
	| { verdict: 'high'; suggest: number | null }
	/** `suggest` null: the highest step already (or tuner unknown). */
	| { verdict: 'low'; suggest: number | null; atTop: boolean }
);

export function adviseGain({ tuner, gain, noise, messages, clipped }: GainInput): GainAdvice {
	const sigma = noise === null ? null : noiseSigma(noise);
	const roundingDb = sigma === null ? null : roundingCostDb(sigma);
	const clippedShare = messages >= MIN_MESSAGES ? clipped / messages : null;
	const known = { sigma, roundingDb, clippedShare };
	const steps = tuner ? GAIN_STEPS[tuner] : undefined;

	if (clippedShare !== null && clippedShare > MAX_CLIPPED) {
		const lower =
			steps && gain !== null ? steps.filter((s) => s <= gain - STEP_DB).at(-1) : undefined;
		return { ...known, verdict: 'high', suggest: lower ?? null };
	}
	if (roundingDb !== null && roundingDb > MAX_ROUNDING_DB) {
		if (clippedShare !== null && clippedShare > CLIPPED_FOR_RAISE)
			return { ...known, verdict: 'fine' };
		const top = steps?.at(-1);
		const atTop = top !== undefined && gain !== null && gain >= top;
		const higher = steps && gain !== null ? steps.find((s) => s >= gain + STEP_DB) : undefined;
		return { ...known, verdict: 'low', suggest: higher ?? (atTop ? null : (top ?? null)), atTop };
	}
	// The noise is fine; whether messages clip needs traffic.
	return { ...known, verdict: clippedShare === null ? 'unknown' : 'fine' };
}
