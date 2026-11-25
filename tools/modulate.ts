/**
 * Turn a Beast recording back into RTL-SDR samples (src/lib/demod/modulate.ts): to try the
 * demodulator on a known sky when the real one is empty, and to compare it with readsb on
 * the same samples.
 *
 *   bun tools/modulate.ts [oracle/capture.beast] [--seconds 60] [--out sky.u8]
 *                         [--noise noise.u8 | --sigma 0.0095] [--gain-db 0]
 *
 *   lab1090 --replay sky.u8                           (or: bun run dev --replay sky.u8)
 *   readsb --device-type ifile --ifile sky.u8 --iformat UC8 > sky.readsb   (demod-compare.ts)
 *
 * Each message goes out at its Beast timestamp and at the level readsb heard it (its signal
 * byte), plus --gain-db, on a random carrier phase. Noise: a recording of the dongle with
 * nothing on air (`rtl_sdr -f 1090M -s 2.4M -g 49.6 -n 72000000 noise.u8`, looped), or
 * Gaussian with standard deviation --sigma (full scale = 1; 0.0095 is about what the Pi's
 * dongle has). 2.4 million samples a second, 2 bytes each: 4.8 MB per second of recording.
 */
import { modulate } from '../src/lib/demod/modulate.ts';
import { SAMPLE_RATE } from '../src/lib/demod/samples.ts';
import { BeastParser } from '../src/lib/beast/parser.ts';

const args = process.argv.slice(2);
const option = (name: string) => {
	const i = args.indexOf(name);
	return i === -1 ? undefined : args[i + 1];
};
const WITH_VALUE = ['--seconds', '--out', '--noise', '--sigma', '--gain-db'];
const input =
	args.find((a, i) => !a.startsWith('--') && !WITH_VALUE.includes(args[i - 1])) ??
	'oracle/capture.beast';
const seconds = Number(option('--seconds') ?? 60);
const out = option('--out') ?? 'sky.u8';
const gain = 10 ** (Number(option('--gain-db') ?? 0) / 20);
const noiseFile = option('--noise');
const sigma = Number(option('--sigma') ?? 0);

const frames = new BeastParser()
	.push(new Uint8Array(await Bun.file(input).arrayBuffer()))
	.filter((f) => f.kind !== 'modeac');
const t0 = frames[0].timestamp;
/** Start a little after the first sample, so the first message is whole. */
const LEAD = 1000;
const sent = frames
	.filter((f) => f.timestamp - t0 < seconds * 12e6)
	.map((f, i) => ({
		data: f.data,
		at: LEAD + (f.timestamp - t0) / 5, // 12 MHz ticks → samples
		amplitude: Math.min(1, (f.signal / 255) * gain),
		// Its own carrier phase, the same in both pieces if it straddles two (golden angle).
		phase: (i * 2.39996) % (2 * Math.PI)
	}));

// In pieces of 10 s: a whole hour at once wouldn't fit in memory.
const PIECE = 10 * SAMPLE_RATE;
const total = Math.ceil(seconds * SAMPLE_RATE) + LEAD;
const background = noiseFile ? new Uint8Array(await Bun.file(noiseFile).arrayBuffer()) : undefined;
const writer = Bun.file(out).writer();
for (let start = 0; start < total; start += PIECE) {
	const length = Math.min(PIECE, total - start);
	// Messages that overlap this piece, moved to its start: one straddling two pieces is drawn
	// in both, each its part.
	const here = sent
		.filter((t) => t.at < start + length && t.at + 300 > start)
		.map((t) => ({ ...t, at: t.at - start }));
	// The background loops from where the previous piece left off.
	const offset = background ? (2 * start) % (background.length & ~1) : 0;
	let noise: Uint8Array | undefined;
	if (background) {
		noise = new Uint8Array(background.length);
		noise.set(background.subarray(offset));
		noise.set(background.subarray(0, offset), background.length - offset);
	}
	writer.write(modulate(here, length, { background: noise, noise: sigma, seed: start + 1 }));
}
await writer.end();
console.log(
	`${sent.length} messages, ${seconds} s → ${out} (${((total * 2) / 1e6).toFixed(0)} MB)`
);
