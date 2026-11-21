/**
 * The dongle's clock against the computer's: are samples getting lost, and how far off is
 * the dongle's crystal?
 *
 * The RTL-SDR takes its 2.4 million samples a second from its own 28.8 MHz crystal, so the
 * samples are a clock too. Compare how many arrived with how much time passed on the
 * computer's clock (performance.now(): monotonic, kept right by NTP), and the difference, the
 * LAG (wall time minus sample time, ms), says two things:
 *
 *   lag ▲
 *       │              ┌─────────     a step: a buffer of samples went missing
 *       │      ________│              (USB, rtl_tcp or our reading fell behind)
 *       │_____/                       a slope: the crystal is off, +1 ppm = 1 ms less
 *       └──────────────────────► t    lag per 1000 s (more samples than the clock expects)
 *
 * The samples come in chunks, through a pipe or TCP, so each arrives a little late, by a
 * few ms to tens of ms that change all the time. That delay only adds to the lag, so the
 * smallest lag in a WINDOW_MS stretch is the steady part. The fit and the steps work on
 * those minima.
 *
 * A step is a rise of more than STEP_MS between two windows that stays in the next one. A
 * rise that goes away again was a stall: everything arrived late, but nothing was lost
 * (librtlsdr holds ~0.8 s of samples in its buffers). A lost buffer is 55 ms (rtl_sdr and
 * rtl_tcp read 256 KiB at a time = 131,072 samples), far above both the drift between
 * windows (1 ms at 100 ppm) and the minima's own jitter.
 *
 * The crystal error is the slope of a least-squares line through the minima (steps taken
 * out), with its standard error: each window adds a point, so it gets better the longer a
 * run goes. One run at a time: a restart starts a new line.
 *
 * On a warm dongle that's right: a restart read −18.9 ± 0.1 ppm within 3 minutes, as rtl_sdr
 * measured against CLOCK_MONOTONIC (18 Nov 2026; against CLOCK_MONOTONIC_RAW, the Pi's own
 * crystal, −11.8: the 7 ppm between them is NTP's correction of it). From a cold one it isn't:
 * the crystal warms up for a quarter of an hour (−183 ppm after 2 minutes, −100 by minute 16
 * while showing ±2), a curve the line can't follow and whose ± assumes it can.
 *
 * It also follows the weather (21 Nov 2026): +0.3 ppm at 03:00; after a
 * restart at 15:27, 9.3 → 7.7 → 16.3 ppm over 25 minutes, showing ±0.1–0.4 all the while;
 * rtl_test -p then read +14. A 2 s SIGSTOP of lab1090 counted one gap of 1,229 ms
 * (librtlsdr's buffers held the rest), a 0.5 s one a stall, nothing lost.
 * TODO: fit only the last ~10 minutes, so the number follows a warm-up and its ± is honest.
 */
import type { ClockReport } from '#lib/receiver-types.ts';

/** Length of the stretches whose smallest lag is taken, ms. */
export const WINDOW_MS = 10_000;
/** A rise bigger than this between two windows, staying, counts as samples lost, ms. */
export const STEP_MS = 25;
/** The first windows of a run are left out: the stream is still settling. */
const SETTLE_WINDOWS = 2;

export class SampleClock {
	#rate: number;
	/** performance.now() when the first sample arrived, and samples since. */
	#start: number | null = null;
	#samples = 0;
	/** The window being filled: its start and its smallest lag so far. */
	#windowStart = 0;
	#windowMin = Infinity;
	#windows = 0;
	/** Lost so far (ms), and the steps. */
	#lost = 0;
	#gaps = 0;
	/** The level (minimum lag, steps taken out) of the last window that counted. */
	#last: number | null = null;
	/** A window that rose by more than STEP_MS: kept back until the next one says why. */
	#held: { t: number; lag: number } | null = null;
	/** Least-squares sums over (t s, lag ms), both relative to the first point. */
	#fit = { n: 0, x0: 0, y0: 0, sx: 0, sy: 0, sxx: 0, sxy: 0, syy: 0 };

	/** `rate`: samples per second as set (2.4 million). */
	constructor(rate: number) {
		this.#rate = rate;
	}

	/** `count` samples arrived at `now` (performance.now(), ms). */
	add(count: number, now: number): void {
		if (this.#start === null) {
			// The first chunk's samples were all there by now: they start the count.
			this.#start = now - (count / this.#rate) * 1000;
			this.#windowStart = now;
		}
		this.#samples += count;
		const lag = now - this.#start - (this.#samples / this.#rate) * 1000;
		if (now - this.#windowStart >= WINDOW_MS) {
			this.#window(this.#windowStart, this.#windowMin);
			this.#windowStart = now;
			this.#windowMin = Infinity;
		}
		this.#windowMin = Math.min(this.#windowMin, lag);
	}

	report(now: number): ClockReport {
		const f = this.#fit;
		let ppm: number | null = null;
		let ppmError: number | null = null;
		if (f.n >= 3) {
			const sxx = f.sxx - (f.sx * f.sx) / f.n;
			const sxy = f.sxy - (f.sx * f.sy) / f.n;
			const syy = f.syy - (f.sy * f.sy) / f.n;
			const slope = sxy / sxx; // ms of lag per s
			const residual = Math.max(0, syy - slope * sxy) / (f.n - 2);
			// Fewer samples than expected per second of wall time makes the lag grow: a slow
			// crystal. ms per s = 1000 ppm.
			ppm = -slope * 1000;
			ppmError = Math.sqrt(residual / sxx) * 1000;
		}
		return {
			seconds: this.#start === null ? 0 : (now - this.#start) / 1000,
			ppm,
			ppmError,
			lostMs: this.#lost,
			gaps: this.#gaps
		};
	}

	#window(t: number, min: number): void {
		if (++this.#windows <= SETTLE_WINDOWS) return;
		const lag = min - this.#lost;
		const held = this.#held;
		if (held) {
			this.#held = null;
			const last = this.#last!;
			if (lag - last > STEP_MS) {
				// Still up: samples went missing. The step is measured from the line so far, not
				// from the last window: that one held the drop, so its minimum is the lag at the
				// moment of the drop, not at the end like the others (the crystal's drift makes
				// a window's minimum sit at one end).
				const step = lag - this.#predict(t, last);
				this.#lost += step;
				this.#gaps++;
				this.#point(held.t, held.lag - step);
				this.#point(t, lag - step);
			} else {
				// Back down: a stall. The held window is left out.
				this.#point(t, lag);
			}
			return;
		}
		if (this.#last !== null && lag - this.#last > STEP_MS) {
			this.#held = { t, lag };
			return;
		}
		this.#point(t, lag);
	}

	/** Where the line fitted so far puts the lag at t; `fallback` before there is one. */
	#predict(tMs: number, fallback: number): number {
		const f = this.#fit;
		if (f.n < 3) return fallback;
		const sxx = f.sxx - (f.sx * f.sx) / f.n;
		const slope = (f.sxy - (f.sx * f.sy) / f.n) / sxx;
		const x = (tMs - f.x0) / 1000;
		return f.y0 + f.sy / f.n + slope * (x - f.sx / f.n);
	}

	#point(tMs: number, lag: number): void {
		const f = this.#fit;
		if (f.n === 0) {
			f.x0 = tMs;
			f.y0 = lag;
		}
		this.#last = lag;
		const x = (tMs - f.x0) / 1000;
		const y = lag - f.y0;
		f.n++;
		f.sx += x;
		f.sy += y;
		f.sxx += x * x;
		f.sxy += x * y;
		f.syy += y * y;
	}
}
