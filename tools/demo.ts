/**
 * The static demo's data, from a Beast recording: the recording made into a seamless loop
 * (src/lib/demo/fold.ts: whole aircraft only, the busiest seam), cut into 10-minute files,
 * gzipped, and the manifest saying what they are (src/lib/demo/manifest.ts).
 *
 *   bun tools/demo.ts sky.beast --position 52.51,13.37 --recorded-at 2026-11-25T14:54:47
 *                     [--min-loop 3h] [--out demo-data]
 *   bun run build:demo        # the site, in build-demo/ (its demo/ is a copy of demo-data/)
 *   bun run dev:demo          # the same in the dev server
 *
 * The recording: lab1090 with --beast-out 30005 on the receiver, and next to it
 *
 *   timeout 4h bash -c 'cat < /dev/tcp/localhost/30005' > sky.beast
 *
 * A few hours at a busy time; the loop is at least --min-loop of it (default 3h). Longer
 * leaves more seams to choose from.
 *
 * --position is the receiver's position the demo shows. The recording itself doesn't say
 * where it was made, so it can be a few km from the real antenna: nothing in the demo
 * needs it exact (positions are decoded from CPR pairs, the reference only settles which
 * of the possible ones), only the range rings and the terrain's horizon are drawn around it.
 *
 * --recorded-at: when the recording's first message came, local time (a Beast file only
 * has the receiver's clock). `stat` gives when the file was last written, its end.
 */
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { encodeFrame } from '../src/lib/beast/encode.ts';
import { BeastParser } from '../src/lib/beast/parser.ts';
import { foldRecording } from '../src/lib/demo/fold.ts';
import { MANIFEST_FILE, type DemoManifest } from '../src/lib/demo/manifest.ts';
import { parseCoordinates } from '../src/lib/setup/coordinates.ts';

const CHUNK_MS = 10 * 60_000;
const TICKS_PER_MS = 12_000;

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		position: { type: 'string' },
		'recorded-at': { type: 'string' },
		'min-loop': { type: 'string', default: '3h' },
		out: { type: 'string', default: 'demo-data' }
	}
});
const fail = (message: string): never => {
	console.error(`demo.ts: ${message}`);
	process.exit(2);
};

const file = positionals[0] ?? fail('which recording? bun tools/demo.ts sky.beast --position …');
const parsed = parseCoordinates(values.position ?? fail('--position <lat,lon> is needed'));
if ('error' in parsed) fail(`--position: ${parsed.error}`);
const reference = (parsed as Exclude<typeof parsed, { error: string }>).position;
const recordedAt = new Date(
	values['recorded-at'] ?? fail('--recorded-at <time> is needed')
).getTime();
if (Number.isNaN(recordedAt)) fail(`--recorded-at: not a time: ${values['recorded-at']}`);
const loop = /^(\d+(?:\.\d+)?)(m|h)$/.exec(values['min-loop']);
if (!loop) fail(`--min-loop: expected e.g. 3h or 150m, got ${values['min-loop']}`);
const minLoopMs = Number(loop![1]) * (loop![2] === 'h' ? 3_600_000 : 60_000);

const frames = new BeastParser().push(await Bun.file(file).bytes());
const fold = foldRecording(frames, minLoopMs);
const minutes = (ms: number) => `${Math.round(ms / 60_000)} min`;
console.log(
	`${frames.length} messages over ${minutes((frames.at(-1)!.timestamp - frames[0].timestamp) / TICKS_PER_MS)}: ` +
		`a loop of ${minutes(fold.loopMs)} from ${minutes(fold.startMs)} in, ${fold.frames.length} messages, ` +
		`${fold.shown} aircraft visits shown, ${fold.left} left out.\n` +
		`Aircraft in range, the quietest 5 minutes: ${fold.seamLow.toFixed(1)} around the seam, ` +
		`${fold.loopLow.toFixed(1)} in the whole loop.`
);

// The files: written afresh (old chunks of another loop would be served next to the new).
const out = values.out;
mkdirSync(out, { recursive: true });
for (const name of readdirSync(out)) {
	if (name === MANIFEST_FILE || name.endsWith('.beast.gz')) rmSync(join(out, name));
}
const chunks: string[] = [];
let next = 0;
for (let from = 0; from < fold.loopMs; from += CHUNK_MS) {
	const end = Math.min(from + CHUNK_MS, fold.loopMs) * TICKS_PER_MS;
	const parts: Uint8Array[] = [];
	while (next < fold.frames.length && fold.frames[next].timestamp < end) {
		parts.push(encodeFrame(fold.frames[next++]));
	}
	const name = `${String(chunks.length).padStart(3, '0')}.beast.gz`;
	await Bun.write(join(out, name), Bun.gzipSync(Buffer.concat(parts), { level: 9 }));
	chunks.push(name);
}
const manifest: DemoManifest = {
	version: 1,
	reference,
	recordedAt: recordedAt + fold.startMs,
	loopMs: fold.loopMs,
	chunkMs: CHUNK_MS,
	chunks
};
await Bun.write(join(out, MANIFEST_FILE), `${JSON.stringify(manifest, null, '\t')}\n`);
const bytes = chunks.reduce((sum, name) => sum + Bun.file(join(out, name)).size, 0);
console.log(`${out}/: ${MANIFEST_FILE} and ${chunks.length} files, ${(bytes / 1e6).toFixed(1)} MB`);
