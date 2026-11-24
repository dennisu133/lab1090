/**
 * Print every Mode S message in a Beast capture as hex, one per line. Input for the pyModeS
 * oracle:
 *
 *   bun tools/dump-messages.ts oracle/capture.beast | tools/.venv/bin/python tools/oracle.py
 *
 * By default deduplicated (aircraft repeat themselves a lot). With --timed: every message in
 * capture order, prefixed with the receiver timestamp in seconds ("12.345678 8d…"), for
 * oracles that depend on order and timing (CPR pairs).
 */
import { BeastParser } from '../src/lib/server/beast/parser.ts';
import { toHex } from '../src/lib/modes/frame.ts';

const args = process.argv.slice(2);
const timed = args.includes('--timed');
const path = args.find((a) => !a.startsWith('--')) ?? 'oracle/capture.beast';
const frames = new BeastParser().push(new Uint8Array(await Bun.file(path).arrayBuffer()));
const seen = new Set<string>();
for (const f of frames) {
	if (f.kind === 'modeac') continue;
	const hex = toHex(f.data);
	if (timed) {
		// The Beast timestamp counts at 12 MHz.
		console.log(`${(f.timestamp / 12e6).toFixed(6)} ${hex}`);
	} else if (!seen.has(hex)) {
		seen.add(hex);
		console.log(hex);
	}
}
