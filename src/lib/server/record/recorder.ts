import { closeSync, ftruncateSync, openSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { magnitudeDbfs, SAMPLE_RATE } from '#lib/demod/samples.ts';
import { bytesText, minutesSeconds } from '#lib/describe/format.ts';
import type { DemodReport, RecordingReport } from '#lib/receiver-types.ts';
import type { SampleDecoder, SampleTap } from '../sdr/decoder';
import { FREQUENCY_HZ } from '../sdr/rtl-sdr';
import { headerFrame, trailerFrame } from './archive';
import {
	MAX_SEGMENTS,
	toSigmf,
	type RecordedStats,
	type RecordingMetadata,
	type Segment
} from './metadata';

/**
 * `--record`: the raw samples, as they come from the RTL-SDR, into a file (archive.ts:
 * SigMF, compressed), while everything else goes on as usual. For tuning the demodulator
 * to dongles and skies other than ours: a recording from elsewhere can be played back
 * (`--replay`) and compared with readsb as often as needed.
 *
 * It taps the SampleDecoder: every sample it's given, before the demodulator. The recording
 * starts with the first samples and ends when it has `plannedSamples` (counted in samples,
 * not by the clock: 5 minutes are 720 million, like the tuning recordings a–c), or earlier
 * when lab1090 stops (finish).
 *
 * The samples are gathered a second at a time and compressed on Bun's worker threads
 * (Bun.zstdCompress: the main thread, which demodulates, never waits for it; on a Pi 5,
 * zstd level 1 costs 3.9 % of a core and the SHA-512 1.3 %, measured 23 Nov 2026), then
 * written in order. A second's samples count as recorded once written: if lab1090 stops
 * meanwhile, the ones still being compressed are left out, so finish() can close the
 * file at once, without waiting (it runs on Ctrl+C, and in `exit`, where nothing waits).
 */

export interface RecorderOptions {
	/** The file's name without `.sigmf.zst`; also the archive's directory (archive.ts). */
	base: string;
	/** Where the file goes. */
	directory: string;
	plannedSamples: number;
	label: string | null;
	/** "lab1090 0.1.0". */
	recorder: string;
	source: RecordingMetadata['source'];
	/** Says when it starts and ends (the console). */
	log?: (line: string) => void;
	/** Compression, for tests; zstd level 1 by default (archive.ts says why 1). */
	compress?: (data: Uint8Array) => Promise<Uint8Array>;
}

/** Samples gathered before they're compressed: one second's. */
const CHUNK_BYTES = SAMPLE_RATE * 2;
/**
 * Seconds waiting to be compressed or written. More than this: the machine can't keep up,
 * and the recording stops (rather than fill the memory).
 */
const MAX_PENDING = 8;

/** The file's extension: a SigMF archive, compressed. */
export const EXTENSION = '.sigmf.zst';

export class SampleRecorder implements SampleTap {
	readonly path: string;
	readonly file: string;
	#options: RecorderOptions;
	#compress: (data: Uint8Array) => Promise<Uint8Array>;
	#log: (line: string) => void;
	#fd: number | null;
	#state: RecordingReport['state'] = 'waiting';
	#stopped: string | null = null;
	#decoder: SampleDecoder | null = null;
	/** The decoder's report when the recording started: its numbers count from there. */
	#before: DemodReport | null = null;
	#startedAt = 0;
	/** Samples taken (some may still be on their way to the file), and written. */
	#taken = 0;
	#written = 0;
	/** The file's length so far. */
	#offset = 0;
	#segments: Segment[] = [];
	#buffer = new Uint8Array(CHUNK_BYTES);
	#fill = 0;
	#pending = 0;
	/** A write failed: the ones queued after it are left out. */
	#broken = false;
	/** The writes, one after the other. */
	#queue: Promise<void> = Promise.resolve();
	#hash = new Bun.CryptoHasher('sha512');

	/** Creates the file (never over an existing one): throws if it can't. */
	constructor(options: RecorderOptions) {
		this.#options = options;
		this.#compress = options.compress ?? ((data) => Bun.zstdCompress(data, { level: 1 }));
		this.#log = options.log ?? (() => {});
		this.file = `${options.base}${EXTENSION}`;
		this.path = join(options.directory, this.file);
		this.#fd = openSync(this.path, 'wx');
		const header = this.#header(options.plannedSamples * 2);
		writeAt(this.#fd, header, 0);
		this.#offset = header.length;
	}

	/** The decoder whose samples are recorded: for the dongle's details and the numbers. */
	attach(decoder: SampleDecoder): void {
		this.#decoder = decoder;
		decoder.tap = this;
	}

	/** A new run of samples (SampleTap): a new capture segment. */
	restart(): void {
		if (this.#state !== 'recording') return;
		if (this.#segments.length >= MAX_SEGMENTS) {
			this.#stop(`the samples broke off ${MAX_SEGMENTS} times`);
			return;
		}
		this.#segments.push({ sampleStart: this.#taken, t: Date.now() });
	}

	/** Samples (SampleTap), I/Q bytes; copied, the caller may reuse its buffer. */
	push(iq: Uint8Array): void {
		if (this.#state === 'waiting') this.#begin();
		if (this.#state !== 'recording') return;
		const wanted = (this.#options.plannedSamples - this.#taken) * 2;
		let data = iq.length > wanted ? iq.subarray(0, wanted) : iq;
		this.#taken += data.length / 2;
		while (data.length > 0) {
			const n = Math.min(data.length, CHUNK_BYTES - this.#fill);
			this.#buffer.set(data.subarray(0, n), this.#fill);
			this.#fill += n;
			data = data.subarray(n);
			if (this.#fill === CHUNK_BYTES) this.#submit();
		}
		if (this.#taken >= this.#options.plannedSamples) {
			this.#submit();
			this.#state = 'finishing';
			void this.#queue.then(() => this.finish(null));
		}
	}

	/**
	 * End the recording now, with what's written (`stopped`: why early; null: complete), and
	 * close the file. Synchronous: safe in a signal handler or `exit`. Once only.
	 */
	finish(stopped: string | null): void {
		if (this.#fd === null) return;
		const fd = this.#fd;
		this.#fd = null;
		if (this.#written === 0) {
			closeSync(fd);
			unlinkSync(this.path);
			this.#state = 'failed';
			this.#stopped = stopped ?? 'no samples';
			this.#log(`Recording: nothing recorded (${this.#stopped}), no file left`);
			return;
		}
		this.#stopped = stopped;
		const bytes = this.#written * 2;
		try {
			const trailer = trailerFrame(bytes);
			writeAt(fd, trailer, this.#offset);
			this.#offset += trailer.length;
			// Cut off a write that only got halfway (a full disk).
			ftruncateSync(fd, this.#offset);
			writeAt(fd, this.#header(bytes), 0);
			this.#state = 'saved';
		} catch (e) {
			this.#state = 'failed';
			this.#stopped = `the file couldn't be finished: ${(e as Error).message}`;
		} finally {
			closeSync(fd);
		}
		const length = minutesSeconds((this.#written / SAMPLE_RATE) * 1000);
		this.#log(
			this.#state === 'failed'
				? `Recording: ${this.#stopped} (${this.file})`
				: `Recording: saved ${length} of samples to ${this.file} (${bytesText(this.#offset)})` +
						(stopped ? `, stopped early: ${stopped}` : '')
		);
	}

	report(): RecordingReport {
		return {
			file: this.file,
			state: this.#state,
			ms: (this.#taken / SAMPLE_RATE) * 1000,
			plannedMs: (this.#options.plannedSamples / SAMPLE_RATE) * 1000,
			bytes: this.#offset,
			stopped: this.#stopped
		};
	}

	#begin(): void {
		this.#state = 'recording';
		this.#startedAt = Date.now();
		this.#before = this.#decoder?.report() ?? null;
		this.#segments.push({ sampleStart: 0, t: this.#startedAt });
	}

	/** Stop taking samples; what's taken is still written, then the file closed. */
	#stop(reason: string): void {
		if (this.#state !== 'recording') return;
		this.#state = 'finishing';
		this.#fill = 0;
		void this.#queue.then(() => this.finish(reason));
	}

	/** The gathered samples off to be compressed, then written in turn. */
	#submit(): void {
		if (this.#fill === 0) return;
		const raw = this.#buffer.subarray(0, this.#fill);
		this.#buffer = new Uint8Array(CHUNK_BYTES);
		this.#fill = 0;
		if (++this.#pending > MAX_PENDING) {
			this.#pending--;
			this.#stop("this machine couldn't compress the samples as fast as they came");
			return;
		}
		const compressed = this.#compress(raw);
		this.#queue = this.#queue.then(async () => {
			let data: Uint8Array;
			try {
				data = await compressed;
			} catch (e) {
				this.#stop(`compressing failed: ${(e as Error).message}`);
				return;
			} finally {
				this.#pending--;
			}
			if (this.#fd === null || this.#broken) return;
			try {
				writeAt(this.#fd, data, this.#offset);
			} catch (e) {
				const full = (e as NodeJS.ErrnoException).code === 'ENOSPC';
				this.#stop(full ? 'the disk is full' : `writing failed: ${(e as Error).message}`);
				this.#broken = true;
				return;
			}
			this.#offset += data.length;
			this.#hash.update(raw);
			this.#written += raw.length / 2;
		});
	}

	#header(dataBytes: number): Uint8Array {
		const o = this.#options;
		const device = this.#decoder?.device;
		const done = this.#fd === null;
		const metadata: RecordingMetadata = {
			recorder: o.recorder,
			label: o.label,
			source: o.source,
			tuner: device?.tuner ?? null,
			device: device?.name ?? null,
			gainDb: device?.gain ?? null,
			sampleRate: SAMPLE_RATE,
			frequencyHz: FREQUENCY_HZ,
			plannedSamples: o.plannedSamples,
			samples: dataBytes / 2,
			stopped: this.#stopped,
			sha512: done ? this.#hash.digest('hex') : null,
			segments: this.#segments.filter((s) => s.sampleStart < this.#written || !done),
			stats: done ? this.#stats() : null
		};
		const mtime = (this.#startedAt || Date.now()) / 1000;
		return headerFrame(o.base, toSigmf(metadata), dataBytes, mtime);
	}

	/** The demodulator's numbers over the recording. */
	#stats(): RecordedStats | null {
		const a = this.#before;
		const b = this.#decoder?.report();
		if (!a || !b) return null;
		const d = (key: 'candidates' | 'clipped' | 'accepted' | 'repaired' | 'levelSum' | 'blocks') =>
			b.totals[key] - a.totals[key];
		return {
			messages: d('accepted') + d('repaired'),
			candidates: d('candidates'),
			clipped: d('clipped'),
			noiseDbfs: d('blocks') > 0 ? magnitudeDbfs((d('levelSum') / d('blocks')) * 65535) : null,
			lostMs: b.lostMs - a.lostMs,
			ppm: b.clock?.ppm ?? null
		};
	}
}

/**
 * All of `data` at `position`. A write the disk only takes part of counts as a full disk
 * (finish() cuts off what it took).
 */
function writeAt(fd: number, data: Uint8Array, position: number): void {
	if (writeSync(fd, data, 0, data.length, position) < data.length) {
		throw Object.assign(new Error('the disk took only part of a write'), { code: 'ENOSPC' });
	}
}
