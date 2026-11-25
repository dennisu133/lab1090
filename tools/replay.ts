/**
 * Play a Beast recording over TCP, like the Pi's readsb does live: for working on the app
 * when the sky is empty (at night), or with a recording that shows something specific.
 * lab1090 plays one by itself too (`--replay x.beast [--loop]`); this tool adds the synthetic
 * alerts and jammer, and serves several lab1090s at once.
 *
 *   bun tools/replay.ts [oracle/capture.beast] [--port 30105] [--speed 1] [--loop] [--alerts]
 *                       [--jamming]
 *   bun run dev --connect 127.0.0.1:30105
 *
 * Frames go out at the pace they were recorded, by their Beast timestamps (the receiver's
 * 12 MHz clock), so CPR pairs, trails and dead reckoning behave as they would live. Each
 * client gets the recording from the start. --speed 2 plays twice as fast; --loop starts
 * over at the end (the aircraft then jump back to where they were at the start, and the
 * tracker's position check has to deal with that, as it would with a real jump).
 *
 * --alerts mixes synthetic emergencies, an IDENT and an ACAS advisory into the recording
 * (src/lib/tracker/alert-scenario.ts has the timeline: 7700 from 30 s, IDENT at 60 s, a
 * medical priority from 240 s, 7600 from 300 s, an RA between two aircraft at 425 s), to see
 * the banner, the map and the notifications work. With --speed 4 they all come within 2 min.
 *
 * --jamming puts a GNSS jammer 33 km south of 52°N 14°E (src/lib/gnss/jamming-scenario.ts):
 * the aircraft within 50 km of it lose their satellite navigation, for the map's GNSS layer.
 * The first losses come within a minute. One or the other: --alerts wins.
 */
import { encodeFrame } from '../src/lib/beast/encode.ts';
import { BeastParser } from '../src/lib/beast/parser.ts';
import { injectAlerts } from '../src/lib/tracker/alert-scenario.ts';
import { injectJamming } from '../src/lib/gnss/jamming-scenario.ts';

const args = process.argv.slice(2);
const option = (name: string, fallback: number) => {
	const i = args.indexOf(name);
	return i === -1 ? fallback : Number(args[i + 1]);
};
const port = option('--port', 30105);
const speed = option('--speed', 1);
const loop = args.includes('--loop');
const alerts = args.includes('--alerts');
const jamming = !alerts && args.includes('--jamming');
/** Options followed by a value; the others are switches. */
const WITH_VALUE = ['--port', '--speed'];
const path =
	args.find((a, i) => !a.startsWith('--') && !WITH_VALUE.includes(args[i - 1])) ??
	'oracle/capture.beast';

const recorded = new BeastParser().push(new Uint8Array(await Bun.file(path).arrayBuffer()));
const frames = alerts ? injectAlerts(recorded) : jamming ? injectJamming(recorded) : recorded;
const t0 = frames[0].timestamp;
/** When each frame is due, ms after the start (12,000 ticks per ms). */
const due = frames.map((f) => (f.timestamp - t0) / 12_000 / speed);
const length = due.at(-1)!;

/** How often due frames are sent, ms: readsb also sends in small batches. */
const TICK_MS = 50;

Bun.listen<{ timer?: ReturnType<typeof setInterval> }>({
	hostname: '127.0.0.1',
	port,
	socket: {
		open(socket) {
			console.log(
				`client connected, playing ${frames.length} frames (${(length / 1000).toFixed(0)} s)`
			);
			let start = performance.now();
			let next = 0;
			socket.data = {
				timer: setInterval(() => {
					const elapsed = performance.now() - start;
					const batch: Uint8Array[] = [];
					while (next < frames.length && due[next] <= elapsed)
						batch.push(encodeFrame(frames[next++]));
					if (batch.length) socket.write(Buffer.concat(batch));
					if (next === frames.length) {
						if (!loop) return socket.end();
						console.log('starting over');
						start = performance.now();
						next = 0;
					}
				}, TICK_MS)
			};
		},
		close(socket) {
			clearInterval(socket.data.timer);
			console.log('client disconnected');
		},
		data() {}
	}
});
console.log(
	`replaying ${path}${alerts ? ' with the alert scenario' : jamming ? ' with a jammer' : ''} on 127.0.0.1:${port}${speed === 1 ? '' : ` at ${speed}×`}${loop ? ', looping' : ''}`
);
