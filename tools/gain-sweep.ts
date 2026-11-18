/**
 * Which gain hears the most: messages per second at a handful of gains, live.
 *
 *   bun tools/gain-sweep.ts host[:port] [--steps 36.4,40.2,…] [--dwell 40] [--rounds 4]
 *
 * Talks to rtl_tcp (`rtl_tcp -a 0.0.0.0` on the receiver), which can change the gain while
 * the samples flow (command 4), and runs our Demodulator on what comes in. Traffic changes by
 * the minute, so one pass through the gains would compare traffic, not gains: it goes round
 * the steps several times, up and down in turn, and compares each step with the mean of its
 * own round. After a change it waits SETTLE seconds before counting: rtl_tcp has samples
 * from the old gain in its buffers, and the noise level takes a block to follow.
 *
 * Per step: messages/s, DF17/s, aircraft heard (distinct DF11/DF17 addresses), noise (dBFS,
 * the mean magnitude), the share of messages that reached the ADC's limit, the strongest
 * message, candidates/s. The last lines are JSON, for keeping.
 */
import { Demodulator, type DemodulatorStats } from '../src/lib/demod/demodulator.ts';
import { magnitudeDbfs, SAMPLE_RATE } from '../src/lib/demod/samples.ts';
import { setupCommands, tunerName } from '../src/lib/server/sdr/rtl-tcp.ts';

const args = process.argv.slice(2);
const flag = (name: string) => {
	const i = args.indexOf(name);
	return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const steps = (flag('--steps') ?? '29.7,33.8,37.2,40.2,43.4,44.5,48.0,49.6').split(',').map(Number);
const dwell = Number(flag('--dwell') ?? 40);
const rounds = Number(flag('--rounds') ?? 4);
/** Seconds after a gain change that aren't counted. */
const settleSeconds = Number(flag('--settle') ?? 2);
/** Print the noise level every 0.1 s after the first few changes: is the settle long enough? */
const trace = args.includes('--trace') && args.splice(args.indexOf('--trace'), 1).length > 0;
const [target] = args;
if (!target || steps.some((s) => !Number.isFinite(s))) {
	console.error(
		'usage: bun tools/gain-sweep.ts host[:port] [--steps 36.4,40.2] [--dwell 40] [--rounds 4] [--settle 2] [--trace]'
	);
	process.exit(1);
}
const [host, port = '1234'] = target.split(':');

/** A message less than this far above the noise (dB) counts as weak: what gain should add. */
const WEAK_DB = 12;
const HEADER = 12;

interface Measurement {
	round: number;
	gain: number;
	seconds: number;
	messages: number;
	weak: number;
	df17: number;
	aircraft: number;
	noiseDbfs: number;
	clipped: number;
	candidates: number;
	strongest: number;
}

/** The order of the steps in each round: up, then down, so slow changes in traffic cancel. */
const plan: { round: number; gain: number }[] = [];
for (let round = 0; round < rounds; round++)
	for (const gain of round % 2 ? [...steps].reverse() : steps) plan.push({ round, gain });

const results: Measurement[] = [];
const demodulator = new Demodulator();
let header = new Uint8Array(0);
/** A byte of a pair split between two packets. */
let carry: number | null = null;
/** The step under way (rtl_tcp starts at its gain), and samples since it began. */
let index = 0;
let stepSamples = 0;
let before: DemodulatorStats = { ...demodulator.stats };
let messages = 0;
let weak = 0;
let df17 = 0;
let strongest = 0;
let addresses = new Set<string>();
const started = performance.now();
let samplesTotal = 0;
let socket: Bun.Socket | null = null;

function setGain(gain: number): void {
	const bytes = new Uint8Array(5);
	const view = new DataView(bytes.buffer);
	view.setUint8(0, 4);
	view.setUint32(1, Math.round(gain * 10));
	socket?.write(bytes);
}

function nextStep(): void {
	index++;
	if (index === plan.length) finish();
	setGain(plan[index].gain);
	stepSamples = 0;
}

/** Counting starts SETTLE seconds into a step: fresh counts from there. */
function startCounting(): void {
	before = { ...demodulator.stats };
	messages = 0;
	weak = 0;
	df17 = 0;
	strongest = 0;
	addresses = new Set();
}

function endStep(): void {
	const s = demodulator.stats;
	const seconds = (s.samples - before.samples) / SAMPLE_RATE;
	const blocks = s.blocks - before.blocks;
	const m: Measurement = {
		...plan[index],
		seconds,
		messages,
		weak,
		df17,
		aircraft: addresses.size,
		noiseDbfs: blocks ? magnitudeDbfs(((s.levelSum - before.levelSum) / blocks) * 65535) : NaN,
		clipped: s.clipped - before.clipped,
		candidates: s.candidates - before.candidates,
		strongest
	};
	results.push(m);
	console.log(
		`round ${m.round + 1} ${m.gain.toFixed(1).padStart(4)} dB: ` +
			`${(m.messages / seconds).toFixed(1).padStart(5)} msg/s, ` +
			`${(m.weak / seconds).toFixed(1).padStart(4)} weak/s, ` +
			`${(m.df17 / seconds).toFixed(1).padStart(4)} DF17/s, ${String(m.aircraft).padStart(3)} aircraft, ` +
			`noise ${m.noiseDbfs.toFixed(1)} dBFS, clipped ${m.clipped}, ` +
			`strongest ${magnitudeDbfs((m.strongest / 255) * 65535).toFixed(1)} dBFS, ` +
			`${(m.candidates / seconds / 1000).toFixed(1)}k candidates/s`
	);
}

function samples(iq: Uint8Array): void {
	// Whole IQ pairs per step: split the data where a step's time is up.
	let at = 0;
	while (at < iq.length) {
		const settle = settleSeconds * SAMPLE_RATE;
		const end = (settleSeconds + dwell) * SAMPLE_RATE;
		const goal = stepSamples < settle ? settle : end;
		const take = Math.min(iq.length - at, 2 * (goal - stepSamples));
		for (const f of demodulator.push(iq.subarray(at, at + take))) {
			if (stepSamples < settle) continue;
			messages++;
			const level = demodulator.stats.level;
			if (level > 0 && 20 * Math.log10(f.signal / 255 / level) < WEAK_DB) weak++;
			strongest = Math.max(strongest, f.signal);
			const df = f.data[0] >> 3;
			if (df === 17) df17++;
			if (df === 11 || df === 17)
				addresses.add(((f.data[1] << 16) | (f.data[2] << 8) | f.data[3]).toString(16));
		}
		at += take;
		const tenth = Math.floor(stepSamples / (SAMPLE_RATE / 10));
		stepSamples += take / 2;
		if (trace && index > 0 && index < 4 && stepSamples < settle)
			if (Math.floor(stepSamples / (SAMPLE_RATE / 10)) !== tenth)
				console.log(
					`  ${plan[index].gain} dB +${(stepSamples / SAMPLE_RATE).toFixed(1)} s: ` +
						`level ${magnitudeDbfs(demodulator.stats.level * 65535).toFixed(2)} dBFS`
				);
		samplesTotal += take / 2;
		if (stepSamples === settle) startCounting();
		if (stepSamples === end) {
			endStep();
			nextStep();
		}
	}
}

function finish(): never {
	const wall = (performance.now() - started) / 1000;
	console.log(
		`\n${(samplesTotal / wall / 1e6).toFixed(3)} MS/s received over ${wall.toFixed(0)} s ` +
			`(2.4 expected; less means samples were lost)\n`
	);
	// Each step against the mean of its own round: traffic cancels out.
	console.log('gain   msg/s  weak/s  DF17/s  aircraft  vs round  noise   clipped');
	for (const gain of steps) {
		const mine = results.filter((r) => r.gain === gain);
		const rate = (r: Measurement) => r.messages / r.seconds;
		const relative = mine.map((r) => {
			const round = results.filter((o) => o.round === r.round);
			return rate(r) / (round.reduce((sum, o) => sum + rate(o), 0) / round.length);
		});
		const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
		const seconds = mine.reduce((sum, r) => sum + r.seconds, 0);
		const all = mine.reduce((sum, r) => sum + r.messages, 0);
		const clipped = mine.reduce((sum, r) => sum + r.clipped, 0);
		console.log(
			`${gain.toFixed(1).padStart(4)}  ${(all / seconds).toFixed(1).padStart(6)}  ` +
				`${(mine.reduce((sum, r) => sum + r.weak, 0) / seconds).toFixed(1).padStart(6)}  ` +
				`${(mine.reduce((sum, r) => sum + r.df17, 0) / seconds).toFixed(1).padStart(6)}  ` +
				`${mean(mine.map((r) => r.aircraft))
					.toFixed(1)
					.padStart(8)}  ` +
				`${((mean(relative) - 1) * 100).toFixed(1).padStart(7)} %  ` +
				`${mean(mine.map((r) => r.noiseDbfs)).toFixed(1)}  ` +
				`${((clipped / Math.max(1, all)) * 100).toFixed(2)} %`
		);
	}
	console.log(`\n${JSON.stringify({ steps, dwell, rounds, settle: settleSeconds, results })}`);
	socket?.end();
	process.exit(0);
}

socket = await Bun.connect({
	hostname: host,
	port: Number(port),
	socket: {
		open(s) {
			s.write(setupCommands(plan[0].gain));
		},
		data(_s, data) {
			let at = 0;
			if (header.length < HEADER) {
				at = Math.min(HEADER - header.length, data.length);
				header = new Uint8Array([...header, ...data.subarray(0, at)]);
				if (header.length === HEADER) {
					const text = String.fromCharCode(...header);
					if (!text.startsWith('RTL0')) {
						console.error('not an rtl_tcp server');
						process.exit(1);
					}
					console.log(`${tunerName(text) ?? 'unknown tuner'}, ${plan.length} steps of ${dwell} s`);
				}
			}
			// An odd byte left over would shift I and Q: keep it for the next packet.
			let iq = data.subarray(at);
			if (carry !== null) {
				const joined = new Uint8Array(iq.length + 1);
				joined[0] = carry;
				joined.set(iq, 1);
				iq = joined;
				carry = null;
			}
			if (iq.length % 2) {
				carry = iq[iq.length - 1];
				iq = iq.subarray(0, iq.length - 1);
			}
			if (iq.length) samples(iq);
		},
		close() {
			if (index < plan.length) {
				console.error('rtl_tcp closed the connection');
				process.exit(1);
			}
		},
		error(_s, error) {
			console.error(error);
			process.exit(1);
		}
	}
});
