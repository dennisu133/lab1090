import { Demodulator, type DemodulatorStats } from '#lib/demod/demodulator.ts';
import { SAMPLE_RATE } from '#lib/demod/samples.ts';
import type { DemodReport, DeviceInfo } from '#lib/receiver-types.ts';
import type { FrameHandler } from '../frame-source';
import { SampleClock } from './sample-clock';

/** Something that wants the samples too, as they come (a recording: record/recorder.ts). */
export interface SampleTap {
	/** A new run of samples begins (after a gap). */
	restart(): void;
	push(iq: Uint8Array): void;
}

/**
 * Samples → messages, for the sources that deliver samples (rtl_sdr, rtl_tcp, a recording).
 *
 * Each run of samples (a start of rtl_sdr, a connection) gets a new Demodulator: the samples
 * before and after a gap don't belong together. Its clock starts at the server's, so
 * timestamps keep growing across restarts instead of starting over at 0, like readsb's.
 *
 * It also keeps the numbers for /receiver (report()): the demodulator's counts over all
 * runs, the time spent demodulating, and for a live source the sample clock (lost samples,
 * the crystal's error). The source fills in `device` as it learns about the dongle.
 *
 * A `tap` gets every sample before the demodulator does (--record).
 */
export class SampleDecoder {
	readonly device: DeviceInfo;
	tap: SampleTap | null = null;
	#demodulator = new Demodulator();
	#onFrame: FrameHandler;
	#live: boolean;
	/** The counts of the runs before this one. */
	#before: DemodulatorStats = { ...this.#demodulator.stats };
	#busyMs = 0;
	#runs = 0;
	#clock: SampleClock | null = null;
	#lostBefore = 0;
	#gapsBefore = 0;

	/**
	 * `live`: the samples come as the dongle makes them (not a recording we pace ourselves),
	 * so their count can be held against the clock. `gain`: what lab1090 asks for, dB.
	 */
	constructor(onFrame: FrameHandler, { live = true, gain = null as number | null } = {}) {
		this.#onFrame = onFrame;
		this.#live = live;
		this.device = { tuner: null, name: null, serial: null, gain };
	}

	/** A new run of samples begins. */
	restart(): void {
		this.#before = this.#totals();
		if (this.#clock) {
			const { lostMs, gaps } = this.#clock.report(performance.now());
			this.#lostBefore += lostMs;
			this.#gapsBefore += gaps;
		}
		this.#demodulator = new Demodulator({ startTick: Math.round(performance.now() * 12_000) });
		this.#clock = this.#live ? new SampleClock(SAMPLE_RATE) : null;
		this.#runs++;
		this.tap?.restart();
	}

	push(iq: Uint8Array): void {
		this.tap?.push(iq);
		const start = performance.now();
		this.#clock?.add(iq.length / 2, start);
		const frames = this.#demodulator.push(iq);
		this.#busyMs += performance.now() - start;
		for (const frame of frames) {
			try {
				this.#onFrame(frame);
			} catch (error) {
				// A bug in the consumer must not stop the samples.
				console.error('SampleDecoder: onFrame threw', error);
			}
		}
	}

	report(): DemodReport {
		const clock = this.#clock?.report(performance.now()) ?? null;
		return {
			totals: this.#totals(),
			busyMs: this.#busyMs,
			clock,
			lostMs: this.#lostBefore + (clock?.lostMs ?? 0),
			gaps: this.#gapsBefore + (clock?.gaps ?? 0),
			runs: this.#runs,
			device: { ...this.device }
		};
	}

	/** The counts of every run so far, this one included; the level is this run's. */
	#totals(): DemodulatorStats {
		const now = this.#demodulator.stats;
		const sum = { ...now };
		for (const key of Object.keys(sum) as (keyof DemodulatorStats)[]) {
			if (key !== 'level') sum[key] = this.#before[key] + now[key];
		}
		return sum;
	}
}
