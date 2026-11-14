/**
 * Play a Beast recording over TCP, like the Pi's readsb does live: for working on the app
 * when the sky is empty (at night), or with a recording that shows something specific.
 *
 *   bun tools/replay.ts [fixtures/capture.beast] [--port 30105] [--speed 1] [--loop]
 *   RECEIVER_HOST=127.0.0.1 RECEIVER_PORT=30105 bun run dev
 *
 * Frames go out at the pace they were recorded, by their Beast timestamps (the receiver's
 * 12 MHz clock), so CPR pairs, trails and dead reckoning behave as they would live. Each
 * client gets the recording from the start. --speed 2 plays twice as fast; --loop starts
 * over at the end (the aircraft then jump back to where they were at the start, and the
 * tracker's position check has to deal with that, as it would with a real jump).
 */
import { encodeFrame } from '../src/lib/server/beast/encode.ts';
import { BeastParser } from '../src/lib/server/beast/parser.ts';

const args = process.argv.slice(2);
const option = (name: string, fallback: number) => {
	const i = args.indexOf(name);
	return i === -1 ? fallback : Number(args[i + 1]);
};
const port = option('--port', 30105);
const speed = option('--speed', 1);
const loop = args.includes('--loop');
const path =
	args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ??
	'fixtures/capture.beast';

const frames = new BeastParser().push(new Uint8Array(await Bun.file(path).arrayBuffer()));
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
	`replaying ${path} on 127.0.0.1:${port}${speed === 1 ? '' : ` at ${speed}×`}${loop ? ', looping' : ''}`
);
