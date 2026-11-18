/**
 * Measure how the dongle draws a pulse (src/lib/demod/pulse.ts), from a recording and
 * readsb's messages in it (readsb.ts):
 *
 *   bun tools/pulse-shape.ts x.u8 x.readsb [every]     (every: use every nth message, 8)
 *
 * Model: sample k of a message is b + A·Σ g(5k − P) over its pulses P (12 MHz ticks), with
 * its own amplitude A and floor b, and one shape g for all, on a grid of ticks from −20 to
 * 30. For messages readsb got intact we know every pulse, so this is linear least squares:
 *
 * 1. Place each message to the tick (readsb's time is only close): the start whose pulses,
 *    drawn with the current g (at first a box), fit its samples best.
 * 2. Fit A and b per message (two unknowns).
 * 3. Fit g over all messages at once (51 unknowns: the normal equations, solved by Gaussian
 *    elimination), scaled to a peak of 1. Then again from 1 with the new g: three rounds.
 *
 * Prints g, and a table to paste into pulse.ts (which keeps −10 to 19: further out it's
 * noise around 0).
 */
import { Demodulator, type DemodulatedFrame } from '../src/lib/demod/demodulator.ts';
import { magnitudes } from '../src/lib/demod/samples.ts';
import { clockMap, parseReadsb } from './readsb.ts';

const [samplesPath, readsbPath, everyArg] = process.argv.slice(2);
if (!samplesPath || !readsbPath) {
	console.error('usage: bun tools/pulse-shape.ts x.u8 x.readsb [every]');
	process.exit(1);
}
const every = Number(everyArg ?? 8);
const iq = Bun.mmap(samplesPath) as Uint8Array;
const theirs = parseReadsb(await Bun.file(readsbPath).text());

// Our messages, only to line up readsb's clock with ours.
const demodulator = new Demodulator();
const ours: DemodulatedFrame[] = [];
for (let at = 0; at < iq.length; at += 1 << 22)
	ours.push(...demodulator.push(iq.subarray(at, Math.min(iq.length, at + (1 << 22)))));
const toOurs = clockMap(theirs, ours);

const G_FROM = -20;
const G_TO = 30;
const NG = G_TO - G_FROM;

const bitsOf = (hex: string) =>
	[...hex].flatMap((c) => [3, 2, 1, 0].map((b) => (parseInt(c, 16) >> b) & 1));
/** Pulse starts, ticks after the first preamble pulse. */
const pulsesOf = (bits: number[]) => [
	0,
	12,
	42,
	54,
	...bits.map((b, i) => 96 + 12 * i + (b ? 0 : 6))
];
/** A box-shaped pulse: the part of sample k (ticks 5k…5k + 5) inside [P, P + 6). */
const box = (d: number) => Math.max(0, Math.min(d + 5, 6) - Math.max(d, 0)) / 5;

function samples(from: number, count: number): Uint16Array {
	const mag = new Uint16Array(count);
	magnitudes(iq, 2 * from, count, mag, 0);
	return mag;
}

interface Placed {
	pulses: number[];
	from: number;
	mag: Uint16Array;
	A: number;
	b: number;
	misfit: number;
}

function fit(mag: Uint16Array, from: number, pulses: number[], g: (d: number) => number) {
	let n = 0;
	let sx = 0;
	let sy = 0;
	let sxx = 0;
	let sxy = 0;
	const xs = new Float64Array(mag.length);
	for (let i = 0; i < mag.length; i++) {
		let x = 0;
		for (const p of pulses) {
			const d = 5 * (from + i) - p;
			if (d >= G_FROM && d < G_TO) x += g(d);
		}
		xs[i] = x;
		n++;
		sx += x;
		sy += mag[i];
		sxx += x * x;
		sxy += x * mag[i];
	}
	const A = (n * sxy - sx * sy) / (n * sxx - sx * sx);
	const b = (sy - A * sx) / n;
	let r = 0;
	for (let i = 0; i < mag.length; i++) r += (mag[i] - b - A * xs[i]) ** 2;
	return { A, b, misfit: Math.sqrt(r / n) / A };
}

function place(hex: string, near: number, g: (d: number) => number): Placed | null {
	const relative = pulsesOf(bitsOf(hex));
	const span = Math.ceil((96 + 3 * hex.length * 4) / 5) + 9;
	let best: Placed | null = null;
	for (let s = near - 12; s <= near + 12; s++) {
		const from = Math.floor(s / 5) - 4;
		const mag = samples(from, span);
		const pulses = relative.map((p) => p + s);
		const f = fit(mag, from, pulses, g);
		if (f.A > 0 && (!best || f.misfit < best.misfit)) best = { pulses, from, mag, ...f };
	}
	return best;
}

function solve(m: Float64Array[], y: Float64Array): Float64Array {
	const n = y.length;
	const a = m.map((row, i) => [...row, y[i]]);
	for (let c = 0; c < n; c++) {
		let p = c;
		for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
		[a[c], a[p]] = [a[p], a[c]];
		for (let r = 0; r < n; r++) {
			if (r === c) continue;
			const f = a[r][c] / a[c][c];
			for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k];
		}
	}
	return Float64Array.from(a.map((row, i) => row[n] / row[i]));
}

const intact = theirs.filter((t, i) => t.fixed === 0 && i % every === 0);
let g: (d: number) => number = box;
let shape: Float64Array = new Float64Array(NG);
for (let round = 1; round <= 3; round++) {
	const placed = intact.flatMap((t) => place(t.hex, toOurs(t.tick), g) ?? []);
	// Messages that fit (not two overlapping) and aren't clipped.
	const good = placed.filter((p) => p.misfit < 0.35 && p.A < 60000);
	const m = Array.from({ length: NG }, () => new Float64Array(NG));
	const y = new Float64Array(NG);
	const x = new Float64Array(NG);
	for (const p of good) {
		for (let i = 0; i < p.mag.length; i++) {
			x.fill(0);
			for (const pulse of p.pulses) {
				const d = 5 * (p.from + i) - pulse;
				if (d >= G_FROM && d < G_TO) x[d - G_FROM] += p.A;
			}
			const r = p.mag[i] - p.b;
			for (let a = 0; a < NG; a++) {
				if (!x[a]) continue;
				y[a] += x[a] * r;
				for (let c = 0; c < NG; c++) m[a][c] += x[a] * x[c];
			}
		}
	}
	shape = solve(m, y);
	const peak = Math.max(...shape);
	shape = shape.map((v) => v / peak);
	const current = shape;
	g = (d) => current[d - G_FROM];
	const misfits = placed.map((p) => p.misfit).sort((a, b) => a - b);
	console.log(
		`round ${round}: ${good.length} of ${intact.length} messages, median misfit ${misfits[misfits.length >> 1].toFixed(3)} of A`
	);
}

console.log('\n   d  g(d)');
for (let d = G_FROM; d < G_TO; d++) {
	const v = shape[d - G_FROM];
	console.log(
		`${String(d).padStart(4)} ${v.toFixed(3).padStart(6)} ${'#'.repeat(Math.max(0, Math.round(v * 40)))}`
	);
}
console.log('\nFor pulse.ts (d = −10 … 19):');
console.log([...shape.slice(-10 - G_FROM, 20 - G_FROM)].map((v) => +v.toFixed(3)).join(', '));
