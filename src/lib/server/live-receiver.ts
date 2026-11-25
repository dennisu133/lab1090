import { statfsSync } from 'node:fs';
import { building } from '$app/env';
import { DEMO } from '#lib/demo/mode.ts';
import { SAMPLE_RATE } from '#lib/demod/samples.ts';
import { bytesText, durationWords, fileTime } from '#lib/describe/format.ts';
import { settings } from './live-settings';
import { Receiver } from './receiver';
import { SampleRecorder } from './record/recorder';
import { VERSION } from './settings';

/**
 * The one Receiver instance of this server process, and the recording, if --record.
 *
 * This module body runs when the server starts and, in dev, again whenever this file or one
 * of its imports is edited (Vite hot reload). A plain module-level `new Receiver()` would then
 * open a second, third, … connection to the receiver while the old ones keep running. So the
 * instance lives on globalThis, which survives reloads: stop the old one, start a new one
 * running the new code. Open browser tabs get disconnected and reconnect by themselves.
 *
 * The recording too, but a reload ends it (the samples break off there) and no new one
 * starts: one --record, one file.
 *
 * Not at all in the demo (DEMO): it has no receiver, the pages play a recording.
 */
const g = globalThis as typeof globalThis & {
	__lab1090Receiver?: Receiver;
	__lab1090Recorder?: SampleRecorder | null;
};

/** zstd leaves about a third of the samples (archive.ts); the free space must hold half. */
const COMPRESSED = 0.33;
const ROOM_NEEDED = 0.5;

if (!building && !DEMO) {
	g.__lab1090Receiver?.stop();
	g.__lab1090Recorder?.finish('the server was reloaded');
	if (g.__lab1090Recorder === undefined) g.__lab1090Recorder = openRecorder();
	g.__lab1090Receiver = new Receiver(settings.source, {
		beastOut: settings.beastOut,
		recorder: g.__lab1090Recorder
	}).start();
}

export function receiver(): Receiver {
	if (!g.__lab1090Receiver) throw new Error('Receiver is not running (are we building?)');
	return g.__lab1090Receiver;
}

/**
 * The file for --record, in the current directory, after checking there's room for it; and
 * whatever stops lab1090 (Ctrl+C, a service's SIGTERM, process.exit) finishes it first, so
 * the file is whole. A file that can't be made ends lab1090: it was asked to record.
 */
function openRecorder(): SampleRecorder | null {
	const record = settings.record;
	const source = settings.source;
	if (!record || (source.kind !== 'rtlsdr' && source.kind !== 'rtl-tcp')) return null;
	const plannedSamples = Math.round((record.durationMs / 1000) * SAMPLE_RATE);
	const directory = process.cwd();
	const raw = plannedSamples * 2;
	let recorder: SampleRecorder;
	try {
		const { bavail, bsize } = statfsSync(directory);
		if (bavail * bsize < raw * ROOM_NEEDED) {
			throw new Error(
				`${durationWords(record.durationMs)} need about ${bytesText(raw * ROOM_NEEDED)} free ` +
					`in ${directory}, there are ${bytesText(bavail * bsize)}: record less (--record-for)`
			);
		}
		recorder = new SampleRecorder({
			base: `lab1090-${fileTime(Date.now())}${record.label ? `-${record.label}` : ''}`,
			directory,
			plannedSamples,
			label: record.label,
			recorder: `lab1090 ${VERSION}`,
			source: source.kind === 'rtlsdr' ? 'rtl_sdr' : 'rtl_tcp',
			log: (line) => console.log(line)
		});
	} catch (e) {
		console.error(`lab1090: --record: ${(e as Error).message}`);
		process.exit(1);
	}
	console.log(
		`Recording for ${durationWords(record.durationMs)} to ${recorder.file} ` +
			`(about ${bytesText(raw * COMPRESSED)}), from the first samples on`
	);
	const stopped = 'lab1090 was stopped';
	for (const [signal, code] of [
		['SIGINT', 130],
		['SIGTERM', 143]
	] as const) {
		process.once(signal, () => {
			recorder.finish(stopped);
			// Listening took the signal's default (ending the process) away: if nobody else
			// listens (in dev: Vite doesn't), end it as the signal would have.
			if (process.listenerCount(signal) === 0) process.exit(code);
		});
	}
	process.once('exit', () => recorder.finish(stopped));
	return recorder;
}
