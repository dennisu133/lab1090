/**
 * How fast the demodulator is on a recording, and whether a change left its output alone.
 *
 *   bun tools/demod-bench.ts x.u8 [seconds] [--save x.out | --check x.out]
 *
 * Prints the messages found and the time taken as a share of the recording's length (= of
 * one core, in real time). --save writes every message (time, signal, bytes) and the stats;
 * --check compares with such a file, for changes meant to be faster and nothing else. For the
 * Pi: bun build --compile --target=bun-linux-arm64 tools/demod-bench.ts --outfile bench
 */
import { Demodulator } from '../src/lib/demod/demodulator.ts';
import { toHex } from '../src/lib/modes/frame.ts';

const args = process.argv.slice(2);
const flag = (name: string) => {
	const i = args.indexOf(name);
	return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const save = flag('--save');
const check = flag('--check');
const [path, seconds] = args;
if (!path) {
	console.error('usage: bun tools/demod-bench.ts x.u8 [seconds] [--save x.out | --check x.out]');
	process.exit(1);
}

/** Bytes per second of UC8 at 2.4 MS/s. */
const RATE = 4.8e6;
const file = Bun.mmap(path);
const iq = seconds ? file.subarray(0, Number(seconds) * RATE) : file;
const demodulator = new Demodulator();
const lines: string[] = [];
const started = performance.now();
for (let at = 0; at < iq.length; at += 262_144)
	for (const f of demodulator.push(iq.subarray(at, at + 262_144)))
		lines.push(`${f.timestamp} ${f.signal} ${toHex(f.data)}`);
const ms = performance.now() - started;
const length = iq.length / RATE;
console.log(
	`${path}: ${lines.length} messages in ${length.toFixed(0)} s of samples, ` +
		`${(ms / 1000).toFixed(2)} s (${(ms / 10 / length).toFixed(1)} % of a core)`
);

// The level is a float sum: compare the counts only.
const counts: Partial<typeof demodulator.stats> = { ...demodulator.stats };
delete counts.level;
delete counts.levelSum;
const output = `${JSON.stringify(counts)}\n${lines.join('\n')}\n`;
if (save) await Bun.write(save, output);
if (check) {
	const before = (await Bun.file(check).text()).split('\n');
	const now = output.split('\n');
	const differ = now.filter((line, i) => line !== before[i]).length;
	if (differ === 0 && now.length === before.length) console.log('same output');
	else {
		console.log(`DIFFERENT: ${differ} lines (${before.length - 2} messages before)`);
		process.exitCode = 1;
	}
}
