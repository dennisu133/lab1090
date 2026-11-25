import type { BeastFrame } from '#lib/beast/parser.ts';
import { AddressFilter } from '#lib/modes/address-filter.ts';
import { checkParity } from '#lib/modes/crc.ts';

/**
 * A recording made into a loop without a seam, for the static demo (tools/demo.ts): played
 * round and round, no aircraft jumps back, vanishes or pops up mid-air when it starts over.
 *
 * Cutting the recording at its ends and starting over wouldn't do: whatever is in the sky
 * at the end vanishes, and whatever was there at the start appears from nowhere. Instead,
 * the recording is cut into aircraft, and each one is shown whole or not at all:
 *
 * - A visit is one aircraft's stay in range: its messages, until it falls silent for
 *   VISIT_GAP_MS (then a later message starts a new visit). The address decides whose a
 *   message is: in the clear (DF11/17), or from the parity once the aircraft was heard in
 *   the clear (AddressFilter's "known"). Visits with fewer than MIN_FRAMES such messages are
 *   noise (a garbled reply's random address), not aircraft.
 * - A visit that starts or ends within EDGE_MS of the recording's ends may have gone on
 *   beyond it: it's never shown (it would appear or vanish mid-air).
 * - The loop is a stretch of the recording, from `start` for `loopMs`: every complete visit
 *   that starts in it is shown, all of it, at its time in the loop (time − start). One that
 *   starts near the loop's end goes on past it, so its rest comes round at the loop's
 *   beginning, while the aircraft that start there begin their own visits: time is taken
 *   modulo `loopMs`. Every aircraft starts once per loop, so the sky at the seam is as busy
 *   as anywhere (each moment has the visits that started in the minutes before it), and
 *   every track goes on where it was.
 * - The same aircraft twice at once (a visit late in the loop wrapping round onto an early
 *   one of the same address) would be two tracks with one address: the later one goes.
 * - Messages that belong to no aircraft (noise, Mode A/C, an unheard AP address) keep their
 *   time if it's in the loop's stretch, and go otherwise.
 *
 * Where the loop starts and how long it is (at least `minLoopMs`) is chosen for the busiest
 * seam: the quietest 5 minutes within SEAM_MS of it, in aircraft on average, as many as
 * possible; of equals, the longest loop. Traffic comes in waves (an airport's banks): a seam
 * at a lull would show a sky emptier than it was.
 *
 * Times are the receiver's clock (Beast timestamps, 12 MHz). The loop's are from 0 at its
 * start: the player (player.ts) places it on the wall clock.
 */

const TICKS_PER_MS = 12_000;
const MINUTE = 60_000;
/** Silence that ends a visit: longer than the gaps of an aircraft at the edge of range. */
export const VISIT_GAP_MS = 5 * MINUTE;
/** A visit that starts or ends this close to the recording's ends may go on beyond it. */
export const EDGE_MS = MINUTE;
/** Messages with a verified address an aircraft's visit needs (a second's worth). */
export const MIN_FRAMES = 10;
/** The seam is judged this far on either side of it… */
const SEAM_MS = 15 * MINUTE;
/** …by its quietest stretch of this long. */
const WINDOW_MS = 5 * MINUTE;
/** Starts and lengths are tried in steps of this. */
const STEP_MS = MINUTE;

interface Visit {
	icao: string;
	/** First and last message with a verified address, ms from the recording's start. */
	first: number;
	last: number;
	/** Messages with a verified address. */
	verified: number;
}

export interface Fold {
	/** The loop's messages, oldest first; timestamps from 0 at the loop's start. */
	frames: BeastFrame[];
	/** Where in the recording the loop starts, ms from its first message. */
	startMs: number;
	loopMs: number;
	/** Aircraft visits shown, and left out (cut by the recording's ends, outside the loop). */
	shown: number;
	left: number;
	/** The busiest seam's quietest 5 minutes, and the whole loop's: aircraft on average. */
	seamLow: number;
	loopLow: number;
}

/** `frames` in arrival order, timestamps as received. */
export function foldRecording(frames: BeastFrame[], minLoopMs: number): Fold {
	if (frames.length === 0) throw new Error('the recording is empty');
	const t0 = frames[0].timestamp;
	const ms = (f: BeastFrame) => (f.timestamp - t0) / TICKS_PER_MS;
	const durationMs = ms(frames.at(-1)!);
	if (durationMs < minLoopMs) {
		throw new Error(
			`the recording is ${Math.floor(durationMs / MINUTE)} minutes, the loop needs at least ${minLoopMs / MINUTE}`
		);
	}

	const visits = findVisits(frames, ms);
	const complete = visits.filter(
		(v) => v.first >= EDGE_MS && v.last <= durationMs - EDGE_MS && v.verified >= MIN_FRAMES
	);

	// The busiest seam.
	let best: { start: number; loop: number; low: number } | null = null;
	for (let start = 0; start + minLoopMs <= durationMs; start += STEP_MS) {
		for (let loop = minLoopMs; start + loop <= durationMs; loop += STEP_MS) {
			const counts = presence(inLoop(complete, start, loop), start, loop);
			const seam = [...counts.slice(-SEAM_MS / MINUTE), ...counts.slice(0, SEAM_MS / MINUTE)];
			const low = quietest(seam);
			if (!best || low > best.low || (low === best.low && loop > best.loop)) {
				best = { start, loop, low };
			}
		}
	}
	const { start, loop } = best!;
	const shown = withoutTwins(inLoop(complete, start, loop), start, loop);

	// Every message to its visit (or none), then to its time in the loop.
	const byIcao = new Map<string, Visit[]>();
	for (const v of visits) byIcao.set(v.icao, [...(byIcao.get(v.icao) ?? []), v]);
	const shownSet = new Set(shown);
	const loopTicks = loop * TICKS_PER_MS;
	const startTicks = start * TICKS_PER_MS;
	const out: BeastFrame[] = [];
	for (const f of frames) {
		const t = ms(f);
		const icao = f.kind === 'modeac' ? null : (checkParity(f.data)?.icao ?? null);
		const visit = icao === null ? undefined : byIcao.get(icao)?.find((v) => near(v, t));
		const aircraft = visit !== undefined && visit.verified >= MIN_FRAMES;
		if (aircraft ? !shownSet.has(visit) : t < start || t >= start + loop) continue;
		const ticks = f.timestamp - t0 - startTicks;
		out.push({ ...f, timestamp: ((ticks % loopTicks) + loopTicks) % loopTicks });
	}
	out.sort((a, b) => a.timestamp - b.timestamp);

	return {
		frames: out,
		startMs: start,
		loopMs: loop,
		shown: shown.length,
		left: visits.filter((v) => v.verified >= MIN_FRAMES).length - shown.length,
		seamLow: best!.low,
		loopLow: quietest(presence(shown, start, loop), true)
	};
}

/** Each aircraft's stays in range, by the messages whose address is verified. */
function findVisits(frames: BeastFrame[], ms: (f: BeastFrame) => number): Visit[] {
	const filter = new AddressFilter();
	const open = new Map<string, Visit>();
	const visits: Visit[] = [];
	for (const f of frames) {
		if (f.kind === 'modeac') continue;
		const t = ms(f);
		const checked = filter.check(f.data, t);
		if (checked?.verdict !== 'valid' && checked?.verdict !== 'known') continue;
		let v = open.get(checked.icao);
		if (!v || t - v.last > VISIT_GAP_MS) {
			v = { icao: checked.icao, first: t, last: t, verified: 0 };
			open.set(checked.icao, v);
			visits.push(v);
		}
		v.last = t;
		v.verified++;
	}
	return visits;
}

/** Is a message at `t` part of this visit (also an AP reply before its first DF11)? */
const near = (v: Visit, t: number) => t >= v.first - VISIT_GAP_MS && t <= v.last + VISIT_GAP_MS;

/** The visits that start in the loop's stretch. */
const inLoop = (visits: Visit[], start: number, loop: number) =>
	visits.filter((v) => v.first >= start && v.first < start + loop);

/** Aircraft in range at every whole minute of the loop. */
function presence(visits: Visit[], start: number, loop: number): number[] {
	const counts = new Array<number>(Math.ceil(loop / MINUTE)).fill(0);
	for (const v of visits) {
		for (let t = Math.ceil(v.first / MINUTE) * MINUTE; t <= v.last; t += MINUTE) {
			counts[Math.floor(((((t - start) % loop) + loop) % loop) / MINUTE)]++;
		}
	}
	return counts;
}

/** The lowest mean over WINDOW_MS of per-minute counts (`round`: the counts go round). */
function quietest(counts: number[], round = false): number {
	const w = WINDOW_MS / MINUTE;
	const series = round ? [...counts, ...counts.slice(0, w - 1)] : counts;
	let low = Infinity;
	for (let i = 0; i + w <= series.length; i++) {
		let sum = 0;
		for (let j = i; j < i + w; j++) sum += series[j];
		low = Math.min(low, sum / w);
	}
	return low;
}

/**
 * Without a visit that would overlap, in the loop, another one of the same aircraft (an
 * address heard early and again late: wrapped round, the two would meet). The later goes.
 */
function withoutTwins(visits: Visit[], start: number, loop: number): Visit[] {
	const kept: Visit[] = [];
	for (const v of [...visits].sort((a, b) => a.first - b.first)) {
		const at = (x: Visit) => x.first - start;
		const meets = kept.some((k) => {
			if (k.icao !== v.icao) return false;
			// Both as stretches of the loop, padded by the gap that would join them.
			const from = (at(v) - at(k) + loop) % loop;
			return (
				from < k.last - k.first + VISIT_GAP_MS || loop - from < v.last - v.first + VISIT_GAP_MS
			);
		});
		if (!meets) kept.push(v);
	}
	return kept;
}
