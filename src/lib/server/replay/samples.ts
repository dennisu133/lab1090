import { existsSync, readFileSync } from 'node:fs';
import { SAMPLE_RATE } from '#lib/demod/samples.ts';
import type { ReplayInfo } from '#lib/receiver-types.ts';
import { fromSigmf, type SigmfInfo } from '../record/metadata';
import type { FrameHandler, FrameSource } from '../frame-source';
import { SampleDecoder } from '../sdr/decoder';
import { FREQUENCY_HZ } from '../sdr/rtl-sdr';
import { SourceBase, type SourceOptions } from '../source-base';
import type { FileFormat } from './format';
import { ByteReader, endOfEntry, nextEntry } from './tar';

/**
 * Samples played back at the pace they were recorded (2.4 million a second, by the clock),
 * and demodulated as they play, as if they came from a dongle: a recording from --record
 * (archive.ts: SigMF, compressed), any SigMF archive of UC8 samples at 2.4 MS/s, or what
 * rtl_sdr writes:
 *
 *   rtl_sdr -f 1090M -s 2.4M -g 49.6 -n 72000000 sky.u8     (30 s, 144 MB)
 *   lab1090 --replay sky.u8
 *
 * A SigMF recording's metadata says what the dongle was (shown on /receiver) and is checked:
 * other sample formats, rates or frequencies can't be demodulated. A bare `x.sigmf-data`
 * gets its `x.sigmf-meta` from beside it.
 *
 * Once, or with `loop` over and over: each time round is a new run of samples (the
 * demodulator starts afresh, as after a gap). The file is read as it plays, never whole.
 */

export interface SampleReplayOptions extends Pick<SourceOptions, 'onStatus'> {
	file: string;
	format: FileFormat & ('samples' | 'sigmf' | 'sigmf-zstd');
	loop: boolean;
	onFrame: FrameHandler;
}

/** How often the samples due by then are read and demodulated. */
const TICK_MS = 50;

export class SampleReplay extends SourceBase implements FrameSource {
	readonly decoder: SampleDecoder;
	replay: ReplayInfo;
	#options: SampleReplayOptions;
	#reader: ByteReader | null = null;

	constructor(options: SampleReplayOptions) {
		super({ onStatus: options.onStatus });
		this.#options = options;
		this.decoder = new SampleDecoder(options.onFrame, { live: false });
		this.replay = {
			file: options.file,
			kind: 'samples',
			loop: options.loop,
			label: null,
			recorder: null,
			recordedAt: null
		};
	}

	start(): this {
		void this.#play().catch((e: Error) => {
			if (this.closed) return;
			console.error(`${this.#options.file}: ${e.message}`);
			this.setStatus({ state: 'ended', reason: e.message });
		});
		return this;
	}

	override close(): void {
		super.close();
		void this.#reader?.cancel();
	}

	async #play(): Promise<void> {
		do {
			const { reader, meta } = await this.#open();
			this.#reader = reader;
			if (meta) this.#learn(meta);
			this.decoder.restart();
			if (this.status.state !== 'connected') this.setStatus({ state: 'connected' });
			const start = performance.now();
			let at = 0;
			for (;;) {
				if (this.closed) return;
				const due = 2 * Math.floor(((performance.now() - start) / 1000) * SAMPLE_RATE);
				if (due > at) {
					const samples = await reader.read(due - at);
					if (this.closed) return;
					if (samples.length > 0) this.decoder.push(samples);
					at += samples.length;
					if (at < due) break; // the end
				}
				await Bun.sleep(TICK_MS);
			}
			await reader.cancel();
		} while (this.#options.loop);
		this.setStatus({ state: 'ended' });
	}

	/** The samples from the start, and the metadata if there is any. */
	async #open(): Promise<{ reader: ByteReader; meta: SigmfInfo | null }> {
		const { file, format } = this.#options;
		const stream = Bun.file(file).stream();
		if (format === 'samples') {
			const metaFile = file.replace(/\.sigmf-data$/, '.sigmf-meta');
			const meta =
				metaFile !== file && existsSync(metaFile)
					? fromSigmf(readFileSync(metaFile, 'utf8'))
					: null;
			return { reader: new ByteReader(stream), meta };
		}
		const reader = new ByteReader(
			// Bun decompresses zstd; TypeScript's DOM types don't list it yet.
			format === 'sigmf-zstd'
				? stream.pipeThrough(new DecompressionStream('zstd' as CompressionFormat))
				: stream
		);
		let meta: SigmfInfo | null = null;
		for (let entry = await nextEntry(reader); entry; entry = await nextEntry(reader)) {
			if (entry.path.endsWith('.sigmf-data')) return { reader, meta };
			const content = await reader.read(entry.size);
			await endOfEntry(reader, entry.size);
			if (entry.path.endsWith('.sigmf-meta')) meta = fromSigmf(new TextDecoder().decode(content));
		}
		throw new Error('no .sigmf-data in the archive');
	}

	/** Check the metadata, and show what it says about the recording. */
	#learn(meta: SigmfInfo): void {
		if (meta.datatype && meta.datatype !== 'cu8') {
			throw new Error(
				`the samples are ${meta.datatype}; lab1090 reads cu8 (8-bit unsigned I/Q, as rtl_sdr writes them)`
			);
		}
		if (meta.sampleRate && meta.sampleRate !== SAMPLE_RATE) {
			throw new Error(
				`recorded at ${meta.sampleRate} samples a second; lab1090 needs ${SAMPLE_RATE}`
			);
		}
		if (meta.frequencyHz && Math.abs(meta.frequencyHz - FREQUENCY_HZ) > 100_000) {
			throw new Error(`recorded at ${meta.frequencyHz / 1e6} MHz, not 1090 MHz`);
		}
		this.decoder.device.tuner = meta.tuner;
		this.decoder.device.gain = meta.gainDb;
		this.replay = {
			...this.replay,
			label: meta.label,
			recorder: meta.recorder,
			recordedAt: meta.t
		};
	}
}
